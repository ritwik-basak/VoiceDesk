import asyncio
import os
import re
import secrets
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from dotenv import load_dotenv
load_dotenv()

import logging
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("groq._base_client").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("opentelemetry").setLevel(logging.ERROR)
logging.getLogger("charset_normalizer").setLevel(logging.WARNING)
logging.getLogger("livekit.agents").setLevel(logging.WARNING)
logging.getLogger("livekit").setLevel(logging.WARNING)

from livekit import agents
from livekit.agents import AgentSession, Agent
from livekit.plugins import deepgram, elevenlabs, silero, cartesia

from app.agent.graph import create_graph, run_conversation_turn
from langchain_core.messages import HumanMessage
from datetime import date, datetime, timedelta
import httpx

room_graphs = {}
room_states = {}

END_PHRASES = (
    "no",
    "no thanks",
    "no thank you",
    "nothing",
    "nothing else",
    "that's all",
    "that is all",
    "thanks",
    "thank you",
    "bye",
    "goodbye",
)

TIME_SLOTS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"]


def _new_reference(prefix: str) -> str:
    return f"{prefix}-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"

def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str) -> int | None:
    value = os.getenv(name)
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        print(f">>> Ignoring invalid integer for {name}: {value}")
        return None


def create_tts():
    provider = os.getenv("TTS_PROVIDER", "elevenlabs").strip().lower()

    if provider == "cartesia":
        model   = os.getenv("CARTESIA_MODEL", "sonic-2")
        voice   = os.getenv("CARTESIA_VOICE_ID", "a0e99841-438c-4a64-b679-ae501e7d6091")
        print(f">>> Using Cartesia TTS: model={model}, voice={voice}")
        return cartesia.TTS(
            model=model,
            voice=voice,
            api_key=os.getenv("CARTESIA_API_KEY"),
            encoding="pcm_s16le",
            sample_rate=44100,
        )

    if provider == "deepgram":
        model = os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en")
        print(f">>> Using Deepgram TTS: model={model}")
        return deepgram.TTS(
            model=model,
            api_key=os.getenv("DEEPGRAM_API_KEY"),
        )

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    model = os.getenv("ELEVENLABS_MODEL", "eleven_turbo_v2_5")
    encoding = os.getenv("ELEVENLABS_ENCODING", "pcm_24000")
    auto_mode = _env_bool("ELEVENLABS_AUTO_MODE", False)

    kwargs = {
        "voice_id": voice_id,
        "model": model,
        "encoding": encoding,
        "api_key": os.getenv("ELEVENLABS_API_KEY") or os.getenv("ELEVEN_API_KEY"),
        "auto_mode": auto_mode,
    }

    streaming_latency = _env_int("ELEVENLABS_STREAMING_LATENCY")
    if streaming_latency is not None:
        kwargs["streaming_latency"] = streaming_latency

    language = os.getenv("ELEVENLABS_LANGUAGE")
    if language:
        kwargs["language"] = language

    print(
        ">>> Using ElevenLabs TTS: "
        f"voice_id={voice_id}, model={model}, encoding={encoding}, "
        f"auto_mode={auto_mode}"
    )
    return elevenlabs.TTS(**kwargs)



WANTS_HUMAN_PHRASES = (
    "talk to a person", "speak to a person", "talk to someone",
    "speak to someone", "human agent", "real agent", "real person",
    "connect me to a human", "connect me to an agent", "speak to a human",
    "want a human", "want to speak to", "customer care", "supervisor",
    "manager", "i want a human", "give me a human",
)

CLARIFICATION_PHRASES = (
    "didn't quite catch", "didn't catch", "could you please repeat",
    "could you repeat", "please repeat", "say that again",
    "one more time", "i'm sorry, i didn't", "pardon",
)



def wants_human(text: str) -> bool:
    t = text.lower()
    return any(phrase in t for phrase in WANTS_HUMAN_PHRASES)


def is_clarification_response(text: str) -> bool:
    t = text.lower()
    return any(phrase in t for phrase in CLARIFICATION_PHRASES)


def wants_to_end(text: str) -> bool:
    normalized = re.sub(r"[^a-zA-Z\s']", " ", text).lower()
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return any(phrase == normalized or phrase in normalized for phrase in END_PHRASES)


async def post_conversation_update(room_name: str, payload: dict):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                "http://127.0.0.1:8000/conversation-update",
                json={"room_name": room_name, **payload},
            )
    except Exception as e:
        print(f">>> Update error: {e}")


async def _save_call_record(state: dict, outcome: str, escalation_reason: str = ""):
    """Persist call record to conversations table for analytics."""
    try:
        from app.db.queries import save_conversation_summary
        patient   = state.get("patient", {})
        slip      = state.get("appointment_slip", {})
        doctor    = (slip.get("doctor") or {}).get("name", "")
        appt_date = (slip.get("slot") or {}).get("date", "")
        appt_time = (slip.get("slot") or {}).get("time", "")
        history   = state.get("history", [])

        await save_conversation_summary(
            phone_number=patient.get("phone_number", ""),
            summary=(
                f"Patient: {patient.get('name', 'Unknown')}. "
                f"Outcome: {outcome}. "
                f"Doctor: {doctor or 'none'}. "
                f"Slot: {appt_date} {appt_time}."
            ),
            appointments=state.get("appointments_made", []),
            preferences={
                "patient_name":       patient.get("name", ""),
                "call_outcome":       outcome,
                "escalation_reason":  escalation_reason,
                "doctor_booked":      doctor,
                "appointment_date":   appt_date,
                "appointment_time":   appt_time,
                "transcript":         history,
                "emergency_triggered": state.get("emergency_triggered", False),
                "emergency_option":   state.get("emergency_option", ""),
            },
            cost_usd=round(state.get("cost_usd", 0.0), 6),
            tokens_used=state.get("tokens_used", 0),
            started_at=state.get("started_at", datetime.now().isoformat()),
            ended_at=datetime.now().isoformat(),
        )
        print(f">>> Call record saved: outcome={outcome}")
    except Exception as e:
        print(f">>> Failed to save call record: {e}")


async def close_call(ctx, session, state, reason: str):
    response_text = (
        "You're welcome. Your appointment is confirmed. "
        "Thank you for calling VoiceDesk. Goodbye."
    )
    history = state.get("history", [])
    history.append({"role": "assistant", "content": response_text})
    state["history"] = history[-20:]
    state["conversation_ended"] = True
    room_states[ctx.room.name] = state

    await session.say(response_text, allow_interruptions=False)
    await asyncio.sleep(1.5)

    await post_conversation_update(
        ctx.room.name,
        {
            "transcript": state.get("history", []),
            "last_response": response_text,
            "conversation_stage": "END",
            "current_intent": "end",
            "tokens_used": state.get("tokens_used", 0),
            "cost_usd": round(state.get("cost_usd", 0.0), 6),
            "appointments_made": state.get("appointments_made", []),
            "patient": state.get("patient", {}),
            "appointment_slip": state.get("appointment_slip", {}),
            "tools_called": ["end_conversation"],
            "call_ended_reason": reason,
        },
    )
    await _save_call_record(state, outcome="completed")
    try:
        await session.aclose()
    except Exception as e:
        print(f">>> Session close error: {e}")
    try:
        ctx.shutdown(reason=reason)
    except Exception as e:
        print(f">>> Context shutdown error: {e}")


async def escalate_call(ctx, session, state, reason: str):
    patient  = state.get("patient", {})
    phone    = patient.get("phone_number", "your registered number")

    reason_map = {
        "medical_emergency":           "a medical emergency was detected",
        "patient_requested_human":     "you requested a human agent",
        "repeated_clarification":      "repeated difficulty understanding your request",
    }
    reason_text = reason_map.get(reason, reason)

    response_text = (
        f"I understand. I'm escalating this call because {reason_text}. "
        f"A VoiceDesk healthcare specialist will call you back at {phone} within 1 hour. "
        f"Please stay available on that number. Thank you for your patience. Goodbye."
    )

    state["conversation_ended"] = True
    state["escalated"]          = True
    room_states[ctx.room.name]  = state

    await session.say(response_text, allow_interruptions=False)
    await asyncio.sleep(1.5)

    await post_conversation_update(
        ctx.room.name,
        {
            "last_response":       response_text,
            "conversation_stage":  "END",
            "escalated":           True,
            "escalation_reason":   reason,
            "escalation_time":     datetime.now().isoformat(),
            "patient":             patient,
            "appointment_slip":    {},
        },
    )
    await _save_call_record(state, outcome="escalated", escalation_reason=reason)
    try:
        await session.aclose()
    except Exception:
        pass
    try:
        ctx.shutdown(reason=f"escalated:{reason}")
    except Exception:
        pass


def _tool_call_name_and_args(tool_call):
    if isinstance(tool_call, dict):
        return tool_call.get("name", ""), tool_call.get("args") or {}
    return getattr(tool_call, "name", ""), getattr(tool_call, "args", {}) or {}


async def build_appointment_slip(
    patient: dict,
    appointment_args: dict,
    room_name: str,
    call_started_at: str | None,
) -> dict:
    from app.db.queries import get_all_doctors
    from app.tools.appointment_tools import find_doctor_fuzzy

    doctor_name = appointment_args.get("doctor_name", "")
    doctors = await get_all_doctors()
    doctor = find_doctor_fuzzy(doctor_name, doctors) or {}

    appointment_date = appointment_args.get("date", "")
    appointment_time = appointment_args.get("time", "")

    # Fee structure by specialization (professional tiered pricing)
    FEES = {
        "General Physician":  {"consultation": 500,  "registration": 100, "service": 50},
        "Dermatologist":      {"consultation": 900,  "registration": 150, "service": 75},
        "Orthopedic Surgeon": {"consultation": 1200, "registration": 200, "service": 100},
        "Pediatrician":       {"consultation": 700,  "registration": 150, "service": 75},
        "Cardiologist":       {"consultation": 1800, "registration": 250, "service": 150},
        "Gynecologist":       {"consultation": 1000, "registration": 200, "service": 100},
        "Neurologist":        {"consultation": 1500, "registration": 250, "service": 150},
        "ENT Specialist":     {"consultation": 800,  "registration": 150, "service": 75},
        "Psychiatrist":       {"consultation": 1200, "registration": 200, "service": 100},
        "Ophthalmologist":    {"consultation": 900,  "registration": 150, "service": 75},
    }
    spec = doctor.get("specialization", "")
    fees = FEES.get(spec, {"consultation": 800, "registration": 150, "service": 75})
    consultation_fee = fees["consultation"]
    registration_fee = fees["registration"]
    service_fee      = fees["service"]

    return {
        "clinic": {
            "name": "VoiceDesk Healthcare Clinic",
            "address": "2nd Floor, Wellness Plaza, MG Road, Bengaluru, Karnataka 560001",
            "phone": "+91 80 4567 2300",
            "email": "appointments@voicedesk.health",
            "gstin": "29AAFCV4821K1Z5",
        },
        "references": {
            "slip_number": _new_reference("VD-SLIP"),
            "invoice_number": _new_reference("INV"),
            "receipt_number": _new_reference("RCPT"),
            "booking_reference": _new_reference("BOOK"),
            "room_reference": room_name,
            "queue_number": f"Q{secrets.randbelow(90) + 10}",
        },
        "patient": {
            "name": patient.get("name") or "Patient",
            "phone_number": patient.get("phone_number") or appointment_args.get("phone_number", ""),
            "patient_id": patient.get("patient_id") or _new_reference("PAT"),
        },
        "doctor": {
            "id": doctor.get("id", ""),
            "name": doctor.get("name") or doctor_name,
            "specialization": doctor.get("specialization", ""),
            "qualification": doctor.get("qualification", ""),
            "experience_years": doctor.get("experience_years", ""),
        },
        "slot": {
            "date": appointment_date,
            "time": appointment_time,
            "status": "Confirmed",
            "type": "Outpatient Consultation",
            "mode": "In-clinic visit",
        },
        "billing": {
            "consultation_fee": consultation_fee,
            "registration_fee": registration_fee,
            "service_fee": service_fee,
            "total_amount": consultation_fee + registration_fee + service_fee,
            "currency": "INR",
            "payment_status": "Pay at clinic",
            "payment_mode": "Counter payment pending",
        },
        "timestamps": {
            "issued_at": datetime.now().isoformat(),
            "call_started_at": call_started_at,
        },
        "instructions": [
            "Please arrive 15 minutes before the appointment time.",
            "Carry a valid photo ID and any previous prescriptions or reports.",
            "This slip is valid only for the appointment slot mentioned above.",
            "For cancellation or rescheduling, contact the clinic before the appointment time.",
        ],
    }


async def build_slot_grid(doctor_name: str) -> dict | None:
    if not doctor_name:
        return None

    from app.db.queries import fetch_slot_status_by_doctor, get_all_doctors
    from app.tools.appointment_tools import find_doctor_fuzzy

    doctors = await get_all_doctors()
    doctor = find_doctor_fuzzy(doctor_name, doctors)
    if not doctor:
        return None

    slots = await fetch_slot_status_by_doctor(doctor["id"])
    status_by_day_time = {
        (str(slot["slot_date"]), str(slot["slot_time"])[:5]): bool(slot["is_available"])
        for slot in slots
    }

    days = []
    for offset in range(1, 8):
        slot_date = date.today() + timedelta(days=offset)
        date_key = slot_date.isoformat()
        days.append({
            "date": date_key,
            "label": slot_date.strftime("%a, %d %b"),
            "slots": [
                {
                    "time": slot_time,
                    "available": status_by_day_time.get((date_key, slot_time), False),
                }
                for slot_time in TIME_SLOTS
            ],
        })

    return {
        "doctor_id": doctor["id"],
        "doctor_name": doctor["name"],
        "specialization": doctor["specialization"],
        "days": days,
    }


async def handle_user_speech(ctx, session, text):
    state = room_states.get(ctx.room.name, {})

    if state.get("conversation_ended", False):
        return

    if state.get("processing", False):
        print(f">>> Skipping (already processing): {text[:30]}")
        return

    state["processing"] = True
    room_states[ctx.room.name] = state

    # Append user message to history immediately so every exit path
    # (close_call, escalate_call, LLM path) sees the final user turn.
    _early_history = state.get("history", [])
    _early_history.append({"role": "user", "content": text})
    state["history"] = _early_history
    room_states[ctx.room.name]["history"] = _early_history
    asyncio.create_task(post_conversation_update(ctx.room.name, {
        "transcript": _early_history,
        "patient": state.get("patient", {}),
        "tokens_used": state.get("tokens_used", 0),
        "cost_usd": state.get("cost_usd", 0.0),
    }))

    # Check if manual phone was submitted via UI
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(
                f"http://127.0.0.1:8000/conversation-status/{ctx.room.name}"
            )
            data = res.json()
            manual_phone = data.get("manual_phone", "")
            # Only inject after the patient has already given their name (at least
            # one prior user message in history beyond the greeting).
            prior_user_turns = sum(1 for m in state.get("history", []) if m.get("role") == "user")
            agent_asked_phone = any(
                "phone" in m.get("content", "").lower()
                for m in state.get("history", [])
                if m.get("role") == "assistant"
            )
            if manual_phone and not state.get("phone_injected", False) and prior_user_turns >= 1 and agent_asked_phone:
                print(f">>> Manual phone detected: {manual_phone}")
                text = f"My phone number is {manual_phone}"
                room_states[ctx.room.name]["phone_injected"] = True
                room_states[ctx.room.name]["manual_phone"] = manual_phone
                room_states[ctx.room.name]["patient"] = {
                    **room_states[ctx.room.name].get("patient", {}),
                    "phone_number": manual_phone,
                }
                # Add to history as if user spoke it
                history = state.get("history", [])
                history.append({"role": "user", "content": text})
                room_states[ctx.room.name]["history"] = history
    except Exception as e:
        print(f">>> Phone check error: {e}")

    try:
        # ── Emergency UI trigger (before LLM) ────────────────────────────
        if "emergency" in text.lower() and not state.get("emergency_triggered", False):
            print(f">>> Emergency detected: {text}")
            room_states[ctx.room.name]["emergency_triggered"] = True
            _em_reply = "I understand. I'm bringing up the emergency options on your screen right now. Please choose an option."
            _em_history = room_states[ctx.room.name].get("history", [])
            _em_history.append({"role": "assistant", "content": _em_reply})
            room_states[ctx.room.name]["history"] = _em_history
            await post_conversation_update(ctx.room.name, {
                "emergency_triggered": True,
                "last_response": _em_reply,
                "transcript": _em_history,
            })
            await session.say(_em_reply, allow_interruptions=False)
            return

        # ── Voice option selection while emergency panel is open ──────────
        if state.get("emergency_triggered", False):
            t = text.lower()
            if any(kw in t for kw in ["specialist", "callback", "call back", "call me", "doctor call"]):
                print(f">>> Emergency option: specialist callback")
                _em_reply = "Confirmed. A specialist will call you within 5 minutes. Please stay calm and keep your phone nearby."
                _em_history = room_states[ctx.room.name].get("history", [])
                _em_history.append({"role": "assistant", "content": _em_reply})
                room_states[ctx.room.name]["history"] = _em_history
                await post_conversation_update(ctx.room.name, {
                    "emergency_option": "callback",
                    "last_response": _em_reply,
                    "transcript": _em_history,
                })
                await session.say(_em_reply, allow_interruptions=False)
                return
            elif any(kw in t for kw in ["ambulance", "book ambulance", "send ambulance"]):
                print(f">>> Emergency option: ambulance")
                _em_reply = "Opening the ambulance form on your screen now."
                _em_history = room_states[ctx.room.name].get("history", [])
                _em_history.append({"role": "assistant", "content": _em_reply})
                room_states[ctx.room.name]["history"] = _em_history
                await post_conversation_update(ctx.room.name, {
                    "emergency_option": "ambulance",
                    "last_response": _em_reply,
                    "transcript": _em_history,
                })
                await session.say(_em_reply, allow_interruptions=False)
                return
            else:
                _em_reply = "Say specialist callback or book ambulance to proceed."
                _em_history = room_states[ctx.room.name].get("history", [])
                _em_history.append({"role": "assistant", "content": _em_reply})
                room_states[ctx.room.name]["history"] = _em_history
                await post_conversation_update(ctx.room.name, {
                    "last_response": _em_reply,
                    "transcript": _em_history,
                })
                await session.say(_em_reply, allow_interruptions=False)
                return

        # ── Escalation checks (run before LLM) ───────────────────────────
        if wants_human(text):
            print(f">>> ESCALATING: patient requested human: {text}")
            await escalate_call(ctx, session, state, "patient_requested_human")
            return

        if state.get("appointments_made") and wants_to_end(text):
            print(f">>> Ending call after completed appointment: {text}")
            await close_call(ctx, session, state, "user_declined_more_help")
            return

        from langchain_groq import ChatGroq
        from app.tools.appointment_tools import (
            identify_user, get_doctors, fetch_slots,
            book_appointment as _base_book_appointment,
            retrieve_appointments,
            cancel_appointment, end_conversation,
        )
        from langgraph.prebuilt import create_react_agent

        llm = ChatGroq(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            api_key=os.getenv("GROQ_API_KEY"),
            max_retries=3,
        )

        from datetime import timezone as _tz
        import zoneinfo as _zi
        today = datetime.now(_zi.ZoneInfo("Asia/Kolkata")).strftime("%A, %Y-%m-%d")
        slot_grid = state.get("slot_grid")
        appts_checked = state.get("appointments_checked", False)
        _patient_phone = state.get("patient", {}).get("phone_number", "")

        # Phone-locked closure — removes phone_number from the schema so the LLM
        # cannot pass the wrong number. Phone is injected from verified state.
        from langchain_core.tools import tool as _mk_tool
        if _patient_phone:
            _sp = _patient_phone
            @_mk_tool
            async def book_appointment(doctor_name: str, date: str, time: str) -> str:
                """Book an appointment with the doctor on the given date and time."""
                return await _base_book_appointment.ainvoke({
                    "phone_number": _sp,
                    "doctor_name": doctor_name,
                    "date": date,
                    "time": time,
                })
        else:
            book_appointment = _base_book_appointment

        phone_context = (
            f"PATIENT PHONE COLLECTED: {_patient_phone}. "
            f"For retrieve_appointments and cancel_appointment use phone_number='{_patient_phone}'. "
            f"For book_appointment, only pass doctor_name, date, and time — phone is automatic."
            if _patient_phone else
            "PATIENT PHONE: NOT YET COLLECTED. "
            "You MUST NOT call identify_user, retrieve_appointments, book_appointment, cancel_appointment, "
            "or any tool that needs a phone number until the patient explicitly tells you their 10-digit number."
        )
        if slot_grid:
            _date_map = ", ".join(
                f"{d['label']} = {d['date']}"
                for d in slot_grid["days"]
            )
            slot_context = (
                f"CURRENT STATE: Slot calendar for Dr. {slot_grid['doctor_name']} is already displayed on the screen. "
                f"You are in STEP 5 — waiting for the patient to choose a date and time. "
                f"DATE REFERENCE (use these exact ISO dates when calling book_appointment): {_date_map}. "
                f"CRITICAL: Do NOT call get_doctors. Do NOT call fetch_slots again. Do NOT list doctors. "
                f"When patient gives a date AND time: output ONLY the STEP 6 confirmation question — call NO tools in that same turn. "
                f"Only call book_appointment in the NEXT separate turn AFTER the patient explicitly says yes/confirm/sure/book."
            )
        else:
            slot_context = "CURRENT STATE: No slot calendar shown yet."
        appt_context = (
            "NOTE: Existing appointments already checked this session — do NOT call retrieve_appointments again."
            if appts_checked else ""
        )

        # Build tool list — remove get_doctors when slot calendar is already visible
        # (no reason to re-list doctors at that point; prevents LLM from resetting flow)
        tools = [
            identify_user, get_doctors, fetch_slots,
            book_appointment, retrieve_appointments,
            cancel_appointment, end_conversation,
        ]
        # Gate: keep retrieve_appointments and cancel_appointment out of the tool
        # list until a phone is known. Open the gate when:
        #   (a) phone is already stored in state, OR
        #   (b) the current user message itself contains a 10-digit phone number
        #       (spoken word form or raw digits) — this lets the LLM call
        #       identify_user + retrieve_appointments in the same turn without a
        #       400 error, while still blocking hallucinated calls on turns like
        #       "My name is Retwick" which contain no phone.
        from app.tools.appointment_tools import _normalize_phone as _np_check
        _phone_in_msg = len(_np_check(text)) >= 10
        if not _patient_phone and not _phone_in_msg:
            tools = [t for t in tools if t.name not in {"retrieve_appointments", "cancel_appointment"}]

        if slot_grid:
            # Slot calendar is showing — no reason to re-list doctors
            tools = [t for t in tools if t.name != "get_doctors"]
            # Only allow booking if the agent JUST asked "shall I book this?" in the
            # most recent assistant message. Read from history (reliable across turns)
            # rather than a flag that can be lost between async calls.
            _recent_history = state.get("history", [])
            _last_assistant = next(
                (m.get("content", "") for m in reversed(_recent_history) if m.get("role") == "assistant"),
                ""
            )
            _confirmation_asked = "shall i book" in _last_assistant.lower()
            if not _confirmation_asked:
                tools = [t for t in tools if t.name != "book_appointment"]

        from datetime import datetime as _dt
        _now  = _dt.now()
        _hour = _now.hour
        _time_str = _now.strftime("%I:%M %p")
        if _hour < 12:
            _period  = "morning"
            _greeting = "Good morning"
        elif _hour < 17:
            _period  = "afternoon"
            _greeting = "Good afternoon"
        else:
            _period  = "evening"
            _greeting = "Good evening"

        agent = create_react_agent(
            llm,
            tools=tools,
            prompt=f"""You are VoiceDesk, an AI healthcare voice receptionist at VoiceDesk Healthcare Clinic.
You speak to patients out loud. Keep responses SHORT - max 2 sentences.
Current time: {_time_str} (it is currently {_period}).

{phone_context}
{slot_context}
{appt_context}

SMALL TALK — one reply then immediately return to current step:
- Greetings (hi/hello/good morning/afternoon/evening): "{_greeting}! Welcome to VoiceDesk."
- How are you: "I'm great, thanks!"
- Who/what are you / are you a bot: "I'm VoiceDesk, your AI clinic receptionist."
- What's your name: "I'm VoiceDesk!"
- Where are you from/located: "I'm a virtual assistant for VoiceDesk Healthcare Clinic."
- What can you do: "I can book, check, and cancel appointments."
- Compliments: "Thank you!"
- I'm fine/good/okay: "Glad to hear that!"
Current period is {_period}. Never say "good morning" if it is afternoon or evening.

STRICT STEP BY STEP FLOW:

STEP 1 - Ask name only: "May I know your full name please?
         You can say it out loud or type it in the box on screen."

STEP 2 - After name received, ask phone only:
         "Thank you [name]! Please share your 10-digit phone number.
         You can say it out loud or type it in the box that appears on screen."
         Do NOT ask for area code — Indian mobile numbers are 10 digits with no area code.

STEP 3 - After phone received, call identify_user tool with name and phone
         number. Then immediately call retrieve_appointments with the same
         phone number to check for existing bookings.

STEP 3b - After retrieve_appointments:
          IF existing appointments are found:
            Say: "I can see you already have an appointment with [doctor name]
            on [human date] at [human time]. Would you like to book another
            appointment, or would you like to cancel this booking?"

            - If patient says cancel / cancel it / yes cancel:
                Call cancel_appointment with the appointment ID from the result.
                Say: "Done, your appointment has been cancelled. Would you
                like to book a new appointment?"
                - If yes → call get_doctors and go to STEP 4
                - If no  → call end_conversation and say goodbye

            - If patient says book / another / yes / new appointment:
                Call get_doctors and go to STEP 4

          IF no existing appointments found:
            Call get_doctors immediately and go to STEP 4.

STEP 4 - After get_doctors, speak ONLY the first 3 doctors by name and
         specialization, then offer the symptom option. Say exactly this pattern:
         "We have [Dr.1, specialization], [Dr.2, specialization], and [Dr.3,
         specialization], among others. If you know who you'd like to see, just
         say their name. Or if you're unsure, briefly describe what you're
         experiencing and I'll recommend the right doctor for you."

STEP 4b - SYMPTOM-BASED RECOMMENDATION (MANDATORY — read carefully):
         If the patient describes symptoms or a health issue instead of naming
         a doctor, output ONLY the recommendation question and call NO tools
         whatsoever in this turn:
         "Based on what you've described, I'd recommend [Doctor Name], our
         [Specialization]. Shall I check their available slots for you?"
         STOP. Do NOT call fetch_slots. Do NOT call any tool. Wait for reply.

         EDGE CASES:
         - If symptoms are vague, unclear, or don't clearly match any
           specialization, fall back to the General Physician. Say:
           "For what you've described, I'd suggest starting with our General
           Physician, [Doctor Name]. Shall I check their available slots?"
           STOP. Do NOT call fetch_slots. Wait for the patient's reply.
         - If patient says yes / sure / okay / go ahead in the NEXT turn
           → THEN call fetch_slots for the recommended doctor.
         - If patient says no / not them / wants someone else: Do NOT call
           fetch_slots. Say: "Of course! Would you like to choose from our
           other doctors, or tell me more so I can find a better match?"
         - CRITICAL: fetch_slots must NEVER be called in the same turn as
           the symptom recommendation. One turn to recommend, next turn to act.

STEP 5 - After doctor chosen (by name or confirmed recommendation),
         AUTOMATICALLY call fetch_slots tool
         for that doctor. Then say:
         "I have shown the available and booked slots on the screen.
         You can pick a date and time by saying it out loud or by
         selecting it on the website. Which slot works for you?"

STEP 5b - If the slot calendar is already shown and the patient's reply
          is missing EITHER a date OR a time entirely (e.g. they say only
          "10 AM" with no day, or only "Monday" with no time), ask for
          the missing piece only:
          - Missing date: "Which date would you prefer?"
          - Missing time: "What time works for you on that day?"
          Natural language like "third May at ten AM", "tomorrow morning",
          "first of May 9 AM", "next Monday at 2" all count as valid —
          convert them and proceed to STEP 6. Only ask for clarification
          when truly one piece is absent.
          AMBIGUITY RULE — number before AM/PM is TIME, not a day:
          If the only digit or number-word in the message appears immediately
          before "AM" or "PM" (e.g. "It's May nine AM", "May 9 AM", "May ten AM"),
          that number is the TIME only — there is NO day present → ask:
          "I didn't catch the day — which date in [month] works for you?
          For example, 8th May at 9 AM."
          A valid date must have an explicit day identifier separate from the
          time: an ordinal (8th, 9th), a cardinal (8, 9 at the start or mid
          of the phrase), or a weekday name (Monday, Saturday etc.).

STEP 6 - MANDATORY CONFIRMATION (NEVER skip or combine with STEP 7):
         When patient gives a date AND time, FIRST look up the date in the
         DATE_REFERENCE map above. If no entry matches, say:
         "I'm sorry, I didn't catch the date — could you say the day and
         time again? For example, 8th May at 9 AM."
         If a match is found, output ONLY this question and call NO tools:
         "Just to confirm - appointment with [doctor] on [EXACT LABEL from
         DATE_REFERENCE] at [human time]. Shall I book this?"
         CRITICAL: use the label from DATE_REFERENCE (e.g. "Sat, 09 May"),
         never echo the patient's raw words as the date.
         STOP. Do NOT call book_appointment. Wait for the next reply.
         If patient says no / different / change / other:
           stay on the slot calendar and say:
           "Of course! Which slot would you prefer?"

STEP 7 - ONLY in the NEXT separate turn, after patient explicitly says
         yes / confirm / correct / okay / sure / book / go ahead,
         call book_appointment tool with:
         phone_number, doctor_name, date (YYYY-MM-DD), time (HH:MM)
         Then say: "Your appointment is confirmed! Your appointment slip
         will appear on screen shortly — you can download it and show
         it at the clinic. Thank you for calling VoiceDesk. Goodbye!"
         Then immediately call end_conversation.

STEP 8 - (Fallback) If an appointment is already confirmed and the patient
         says anything further, call end_conversation and say goodbye.
         Do not show doctors again.

RULES:
- NEVER ask name and phone together
- NEVER make up phone numbers
- NEVER ask for an area code. India uses 10-digit mobile numbers with no separate area code. Just ask for the 10-digit number.
- NEVER cancel multiple appointments in one turn. If the patient says "cancel all",
  call retrieve_appointments first, then cancel only ONE at a time, confirm each
  cancellation, and ask "Would you like to cancel the next one?" before proceeding.
- NEVER skip the confirmation step before booking
- NEVER call identify_user or retrieve_appointments until you have received a
  real 10-digit phone number from the patient in this conversation. Name alone
  is NOT enough. Wait for STEP 2 to complete before calling any tool.
- NEVER call get_doctors before first calling retrieve_appointments after identify_user
- NEVER skip STEP 3b — always check existing appointments before showing doctors
- NEVER call book_appointment in the same turn where the patient first
  gives the date/time. First ask for confirmation, then wait.
- If this session already has confirmed appointments, do not restart
  doctor selection unless the patient asks for another appointment.
- If the patient says "first one", "first doctor", "second one", "the third",
  or any ordinal reference to a doctor, map it to the doctor at that position
  in the list you just spoke (1st = first doctor you named, etc.) and call
  fetch_slots with that doctor's full name. Never ask them to repeat.
- If fetch_slots returns "not found", the doctor name was not recognised.
  Say: "I'm sorry, I didn't catch that doctor's name clearly. Could you
  please repeat it?" Do NOT list doctors again — wait for the patient
  to say the name again, then call fetch_slots with the corrected name.
- If the slot calendar is visible (CURRENT STATE says so), NEVER list
  doctors again unless the patient explicitly asks to change doctor.
- If the slot calendar is visible and the patient gives a message that
  contains BOTH a recognisable day identifier (ordinal, cardinal day number,
  or weekday name — separate from the time number) AND a time reference,
  always convert and proceed to confirmation.
  EXCEPTION: if the only number present is immediately before AM/PM (e.g.
  "May 9 AM", "May nine AM"), that number is the TIME — no day is given →
  ask for the day instead of guessing.
- Only ask for clarification if one part (date OR time) is completely absent.
- If book_appointment returns ANY error (BOOKING FAILED, slot not found,
  cannot book, could not book, already booked, today or past), NEVER say
  "Your appointment is confirmed" and NEVER say "technical issues".
  Instead say clearly what went wrong:
    - Slot taken / already booked → "I'm sorry, that slot is no longer available. Please choose a different date or time from the calendar."
    - Today or past date → "I'm sorry, I can only book future dates. Please choose a date from tomorrow onwards."
    - Any other error → "I'm sorry, I wasn't able to book that slot. Please choose a different time from the calendar."
  Then stay on the slot calendar. NEVER call get_doctors.
- Accept natural language dates: "tomorrow", "third May", "3rd of May",
         "first", "next Monday", "day after tomorrow" etc.
         Convert to YYYY-MM-DD (today is {today})
- Accept natural language times: "ten AM", "9 AM", "morning" (09:00),
         "afternoon" (14:00), "evening" (16:00), "2 in the afternoon" etc.
         Convert to HH:MM format
- When speaking dates to the patient, use human wording like
  "5th May 2026", never raw ISO dates like "2026-05-05".
- When speaking times to the patient, use human wording like
  "2 PM", not "14:00".
- Keep all responses SHORT and conversational
- Never use bullet points or lists in speech
- Never say INTENT: in response
- After fetch_slots is called, immediately tell the patient
  they can select a slot by voice or on the website. Do not read
  every date and time aloud.
- When listing doctors aloud, mention only the first 3 doctors by name.
  All doctors are available — use the full list when matching symptoms.

Confirmed appointments so far: {state.get("appointments_made", [])}""",
        )

        # Build messages from history
        # history already has the user message from the early append above
        history = state.get("history", [])

        print(f">>> Processing: {text}")
        # Keep enough context to preserve booking/confirmation state.
        recent_history = history[-6:] if len(history) > 6 else history

        # Langfuse v4: propagate_attributes() sets session_id/user_id as OTEL
        # context so CallbackHandler spans are grouped into a session.
        try:
            from langfuse import propagate_attributes as _lf_propagate
            from langfuse.langchain import CallbackHandler as _LFHandler

            with _lf_propagate(
                session_id=ctx.room.name,
                user_id=_patient_phone or "unknown",
                trace_name="voice-turn",
            ):
                result = await agent.ainvoke(
                    {"messages": recent_history},
                    config={"callbacks": [_LFHandler()]},
                )
            print(f">>> [Langfuse] turn tracked: session={ctx.room.name[:25]}")
        except ImportError:
            result = await agent.ainvoke({"messages": recent_history})
        except Exception as _lf_err:
            _lf_es = str(_lf_err)
            if "tool_use_failed" in _lf_es or "tool call validation" in _lf_es:
                raise  # Groq tool error — let outer except handle it properly
            print(f">>> [Langfuse] error (falling back): {type(_lf_err).__name__}: {_lf_err}")
            result = await agent.ainvoke({"messages": recent_history})

        response_text = ""
        for msg in reversed(result["messages"]):
            if hasattr(msg, "content") and msg.content and msg.type == "ai":
                response_text = msg.content
                break

        if not response_text:
            response_text = "I'm sorry, could you please repeat that?"

        # Strip raw function-call syntax the LLM sometimes leaks into response text
        # e.g. <function=book_appointment>{...}</function> or {"function": ...}
        _clean = re.sub(r'<function=\w+>[\s\S]*?</function>', '', response_text, flags=re.DOTALL).strip()
        _clean = re.sub(r'\{"function"[\s\S]*?\}', '', _clean, flags=re.DOTALL).strip()
        if _clean != response_text:
            print(f">>> Stripped raw function call from response text")
            response_text = _clean if _clean else "I'm sorry, please could you repeat that?"

        # Keep full history but limit what we send
        history.append({"role": "assistant", "content": response_text})
        # Keep full history trimmed to last 20 messages max
        if len(history) > 20:
            history = history[-20:]
        room_states[ctx.room.name]["history"] = history

        print(f">>> Responding: {response_text[:80]}")
        room_states[ctx.room.name]["last_transcript"] = ""  # allow repeat if user says same thing again

        if "shall i book" in response_text.lower():
            print(">>> Confirmation question asked — book_appointment will be unlocked next turn")

        # ── 3-strikes clarification escalation ───────────────────────────
        if is_clarification_response(response_text):
            count = state.get("clarification_count", 0) + 1
            room_states[ctx.room.name]["clarification_count"] = count
            print(f">>> Clarification failure #{count}")
            if count >= 3:
                print(f">>> ESCALATING: 3 clarification failures")
                await escalate_call(ctx, session, state, "repeated_clarification")
                return
        else:
            room_states[ctx.room.name]["clarification_count"] = 0

        # Detect appointments from tool results
        appointments_made = state.get("appointments_made", [])
        patient = state.get("patient", {})
        appointment_slip = state.get("appointment_slip", {})

        # Build a map of tool_call_id → result content for confirmation check
        tool_results = {}
        for msg in result["messages"]:
            if hasattr(msg, 'type') and msg.type == 'tool':
                tid = getattr(msg, 'tool_call_id', None)
                if tid:
                    tool_results[tid] = msg.content if hasattr(msg, 'content') else ''

        for msg in result["messages"]:
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_name, tool_args = _tool_call_name_and_args(tc)
                    tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)

                    if tool_name == "identify_user":
                        # tool result is "User identified: Name (7550966243)"
                        # use the normalized phone from the result, not raw LLM args
                        result_text = tool_results.get(tc_id, "")
                        phone_match = re.search(r'\((\d{7,})\)', result_text)
                        if phone_match:
                            normalized_phone = phone_match.group(1)
                        else:
                            raw = tool_args.get("phone_number", patient.get("phone_number", ""))
                            normalized_phone = re.sub(r'\D', '', raw)
                        raw_name = tool_args.get("name", patient.get("name", ""))
                        # Reject placeholder/template strings the LLM sometimes passes
                        _bad = {"patient's name", "patient name", "unknown", "name", ""}
                        if raw_name.lower().strip() in _bad:
                            raw_name = patient.get("name", "")
                        patient = {
                            **patient,
                            "name": raw_name,
                            "phone_number": normalized_phone,
                        }

                    if tool_name == "book_appointment":
                        raw_phone = tool_args.get("phone_number", patient.get("phone_number", ""))
                        patient = {
                            **patient,
                            "phone_number": re.sub(r'\D', '', raw_phone) or patient.get("phone_number", ""),
                        }
                        # Only build the slip if the booking actually succeeded
                        result_text = tool_results.get(tc_id, '')
                        if 'confirmed' in result_text.lower():
                            appointments_made.append(result_text)
                            appointment_slip = await build_appointment_slip(
                                patient=patient,
                                appointment_args=tool_args,
                                room_name=ctx.room.name,
                                call_started_at=state.get("started_at"),
                            )

        # Fallback: scan all tool messages for a successful booking in case tc_id matching missed it
        already_tracked = set(appointments_made)
        for msg in result["messages"]:
            if hasattr(msg, 'type') and msg.type == 'tool':
                content = getattr(msg, 'content', '') or ''
                if 'appointment confirmed!' in content.lower() and content not in already_tracked:
                    appointments_made.append(content)
                    already_tracked.add(content)
                    if not appointment_slip:
                        appointment_slip = await build_appointment_slip(
                            patient=patient,
                            appointment_args={},
                            room_name=ctx.room.name,
                            call_started_at=state.get("started_at"),
                        )

        room_states[ctx.room.name]["appointments_made"] = appointments_made
        room_states[ctx.room.name]["patient"]           = patient
        room_states[ctx.room.name]["appointment_slip"]  = appointment_slip

        # Detect tools called
        tools_called = []
        slot_grid = state.get("slot_grid")
        booked_doctor_name = None
        fetch_slots_called = False
        get_doctors_called = False
        for msg in result["messages"]:
            if hasattr(msg, 'tool_calls') and msg.tool_calls:
                for tc in msg.tool_calls:
                    tool_name, tool_args = _tool_call_name_and_args(tc)
                    if tool_name:
                        tools_called.append(tool_name)
                    if tool_name == "retrieve_appointments":
                        room_states[ctx.room.name]["appointments_checked"] = True
                    if tool_name == "get_doctors":
                        get_doctors_called = True
                    if tool_name == "fetch_slots":
                        fetch_slots_called = True
                        doctor_name = tool_args.get("doctor_name", "")
                        new_grid = await build_slot_grid(doctor_name)
                        if new_grid:
                            slot_grid = new_grid
                        else:
                            # Fallback: extract canonical name from the tool result text
                            # e.g. "Slots loaded for Dr. Priya Mehta. 5 slot(s)..."
                            tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                            result_text = tool_results.get(tc_id, "")
                            name_match = re.search(r"Slots loaded for ([^.]+)", result_text)
                            if name_match:
                                canonical = name_match.group(1).strip()
                                new_grid = await build_slot_grid(canonical)
                                if new_grid:
                                    slot_grid = new_grid
                                    print(f">>> build_slot_grid used canonical name '{canonical}' (args had '{doctor_name}')")
                                else:
                                    print(f">>> build_slot_grid failed for both '{doctor_name}' and '{canonical}'")
                            else:
                                print(f">>> build_slot_grid returned None for '{doctor_name}', no canonical fallback")
                    if tool_name == "book_appointment":
                        booked_doctor_name = tool_args.get("doctor_name", "")

        # Only clear slot_grid when get_doctors ran WITHOUT fetch_slots in the same turn.
        # If both ran together (model called get_doctors then fetch_slots to select a doctor),
        # fetch_slots already built the correct new grid — clearing would destroy it.
        if get_doctors_called and not fetch_slots_called:
            slot_grid = None

        # Intercept premature fetch_slots after symptom description.
        # fetch_slots is only valid when the user either (a) named a doctor directly,
        # or (b) confirmed a recommendation. Detect by checking that the user's message
        # contains confirmation/doctor-selection words, or the previous assistant turn
        # was already a recommendation question.
        if fetch_slots_called and slot_grid and not get_doctors_called:
            _confirm_re = re.compile(
                r'\b(yes|yeah|yep|sure|okay|ok|go ahead|confirm|correct|please|'
                r'dr\.?|doctor)\b',
                re.IGNORECASE
            )
            _user_confirmed = bool(_confirm_re.search(text))

            _hist = room_states[ctx.room.name].get("history", [])
            _prev_assistant = ""
            for _m in reversed(_hist[:-1]):
                if _m.get("role") == "assistant":
                    _prev_assistant = _m.get("content", "").lower()
                    break
            _was_recommendation = (
                "shall i check" in _prev_assistant
                or "shall i show" in _prev_assistant
                or "available slots for you" in _prev_assistant
            )

            if not _user_confirmed and not _was_recommendation:
                # LLM jumped straight to slots without confirmation — intercept.
                _rec_doctor = slot_grid.get("doctor_name", "this doctor")
                _rec_spec   = slot_grid.get("specialization", "specialist")
                _rec_msg    = (
                    f"Based on what you've described, I'd recommend {_rec_doctor}, "
                    f"our {_rec_spec}. Shall I show their available slots?"
                )
                response_text = _rec_msg
                slot_grid = None
                _hist.append({"role": "assistant", "content": _rec_msg})
                room_states[ctx.room.name]["history"] = _hist
                room_states[ctx.room.name]["slot_grid"] = None
                print(f">>> Intercepted premature fetch_slots — asking recommendation confirmation")

        # Refresh slot grid after a booking so the booked slot turns grey
        if booked_doctor_name:
            refreshed = await build_slot_grid(booked_doctor_name)
            if refreshed:
                slot_grid = refreshed

        room_states[ctx.room.name]["slot_grid"] = slot_grid

        # Extract actual token counts from LLM response metadata
        # Cerebras llama-3.3-70b pricing: input $0.60/1M, output $0.60/1M
        turn_input  = 0
        turn_output = 0
        from langchain_core.messages import AIMessage as _AIMsg
        for msg in result["messages"]:
            if isinstance(msg, _AIMsg) and msg.usage_metadata:
                turn_input  += msg.usage_metadata.get("input_tokens", 0)
                turn_output += msg.usage_metadata.get("output_tokens", 0)

        # Fall back to a conservative estimate if metadata not available
        if turn_input == 0 and turn_output == 0:
            turn_input, turn_output = 800, 200

        turn_tokens  = turn_input + turn_output
        turn_cost    = (turn_input * 0.00000060) + (turn_output * 0.00000060)
        tokens_used  = state.get("tokens_used", 0) + turn_tokens
        cost_usd     = round(state.get("cost_usd", 0.0) + turn_cost, 6)
        room_states[ctx.room.name]["tokens_used"] = tokens_used
        room_states[ctx.room.name]["cost_usd"]    = cost_usd

        await post_conversation_update(
            ctx.room.name,
            {
                "last_response":      response_text,
                "conversation_stage": "ACTIVE",
                "current_intent":     "",
                "tokens_used":        tokens_used,
                "cost_usd":           cost_usd,
                "appointments_made":  appointments_made,
                "patient":            patient,
                "appointment_slip":   appointment_slip,
                "tools_called":       tools_called,
                "slot_grid":          slot_grid,
                # Always sync history so /voice/stop can use it as transcript
                "transcript":         room_states[ctx.room.name].get("history", []),
            },
        )

        # ── Repeated response guard — agent didn't understand, replace with clarification ──
        last_agent_response = state.get("last_agent_response", "")
        if (last_agent_response.strip() and
                response_text.strip() == last_agent_response.strip() and
                "didn't catch" not in response_text.lower()):
            response_text = "I'm sorry, I didn't quite catch that. Could you please repeat?"
            print(">>> Repeated response detected — replacing with clarification")
        room_states[ctx.room.name]["last_agent_response"] = response_text

        await session.say(response_text, allow_interruptions=False)

        # If LLM said goodbye without calling end_conversation, still save the record
        _is_goodbye = any(w in response_text.lower() for w in ("goodbye", "thank you for calling", "take care, goodbye"))
        if _is_goodbye and not state.get("conversation_ended", False):
            print(">>> LLM said goodbye without end_conversation — saving record")
            await _save_call_record(
                {**state, "appointments_made": appointments_made, "patient": patient},
                outcome="completed" if appointments_made else "no_action",
            )
            room_states[ctx.room.name]["conversation_ended"] = True
            # Mark stage END so /voice/stop does not overwrite with a second "incomplete" record
            await post_conversation_update(ctx.room.name, {"conversation_stage": "END"})

    except Exception as e:
        err_str = str(e)
        if "rate_limit_exceeded" in err_str or "Rate limit reached" in err_str:
            model_match = re.search(r'model `([^`]+)`', err_str)
            retry_match = re.search(r'Please try again in ([^\.\n]+)', err_str)
            model_name  = model_match.group(1) if model_match else os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
            retry_in    = retry_match.group(1).strip() if retry_match else "a few minutes"
            banner_msg  = f"LLM ({model_name}) token limit reached. Please try again in {retry_in}."
            print(f">>> Rate limit: {banner_msg}")
            await post_conversation_update(
                ctx.room.name,
                {"rate_limit_error": banner_msg},
            )
            try:
                await session.say("I've reached my usage limit for now. Please try again in a few minutes.")
            except Exception:
                pass
        elif ("tool_use_failed" in err_str or "tool_use_fail" in err_str or
              "failed_generation" in err_str or
              ("400" in err_str and ("Bad Request" in err_str or "invalid_request_error" in err_str))):
            print(f">>> Tool call format error: {err_str[:200]}")
            _cur_state  = room_states.get(ctx.room.name, {})
            _cur_grid   = _cur_state.get("slot_grid")
            if "book_appointment" in err_str and _cur_grid:
                # LLM tried to book without confirmation — only intercept if the user's
                # message has booking intent (date/time words or affirmations).
                # Avoids adding a spurious confirmation when user asks "Why?" etc.
                _has_booking_intent = bool(re.search(
                    r'\b(yes|sure|confirm|ok|okay|book|go ahead|yeah|yep|please|correct|'
                    r'\d+|am|pm|morning|afternoon|evening|'
                    r'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
                    r'jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|'
                    r'mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|'
                    r'today|tomorrow|next|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b',
                    text, re.IGNORECASE
                ))
                if _has_booking_intent:
                    # Replace word-form numbers so LLM can parse date/time reliably
                    _doc_name = _cur_grid.get("doctor_name", "the doctor")
                    _display = text
                    for _w, _d in [("nine","9"),("ten","10"),("eleven","11"),("twelve","12"),
                                    ("two","2"),("three","3"),("four","4"),("five","5"),
                                    ("six","6"),("seven","7"),("eight","8"),("one","1")]:
                        _display = re.sub(rf'\b{_w}\b', _d, _display, flags=re.IGNORECASE)
                    _confirm = f"Just to confirm - appointment with {_doc_name} on {_display}. Shall I book this?"
                    _hist = room_states[ctx.room.name].get("history", [])
                    _hist.append({"role": "assistant", "content": _confirm})
                    room_states[ctx.room.name]["history"] = _hist
                    print(f">>> Intercepted premature booking — asking confirmation: {_confirm}")
                    try:
                        await session.say(_confirm, allow_interruptions=False)
                    except Exception:
                        pass
                else:
                    # User asked something unrelated — stay on slot calendar
                    _fallback = "I'm sorry, I wasn't able to complete that booking. Please choose a different date or time from the calendar."
                    try:
                        await session.say(_fallback, allow_interruptions=False)
                    except Exception:
                        pass
            else:
                try:
                    await session.say("I'm sorry, I didn't quite catch that. Could you please repeat?", allow_interruptions=False)
                except Exception as _say_err:
                    print(f">>> Fallback say failed: {_say_err}")
        else:
            print(f">>> Agent error: {e}")
            import traceback
            traceback.print_exc()
            try:
                await session.say("I'm sorry, please try again.", allow_interruptions=False)
            except Exception as _say_err:
                print(f">>> Fallback say failed: {_say_err}")
    finally:
        room_states[ctx.room.name]["processing"] = False


async def poll_for_injections(ctx, session):
    while True:
        await asyncio.sleep(2)
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(
                    f"http://127.0.0.1:8000/conversation-status/{ctx.room.name}"
                )
                data = res.json()
                tts_text = data.get("tts_speak_text", "")
                if tts_text:
                    await client.post(
                        "http://127.0.0.1:8000/conversation-update",
                        json={"room_name": ctx.room.name, "tts_speak_text": ""},
                    )
                    await session.say(tts_text, allow_interruptions=False)

                if data.get("has_injection"):
                    message = data.get("injected_message", "")
                    if message:
                        state = room_states.get(ctx.room.name, {})
                        if state.get("processing", False):
                            # Agent is busy — leave injection in place, retry next poll
                            pass
                        else:
                            print(f">>> Injected message: {message}")
                            # Clear only after confirming we can process it
                            await client.post(
                                "http://127.0.0.1:8000/conversation-update",
                                json={
                                    "room_name": ctx.room.name,
                                    "has_injection": False,
                                    "injected_message": "",
                                },
                            )
                            asyncio.create_task(
                                handle_user_speech(ctx, session, message)
                            )
        except Exception:
            pass


class VoiceDeskAgent(Agent):
    def __init__(self, room_name: str, **kwargs):
        super().__init__(**kwargs)
        self._room_name = room_name

    async def tts_node(self, text, model_settings=None):
        try:
            async for frame in super().tts_node(text, model_settings):
                yield frame
        except Exception as e:
            status = getattr(e, 'status_code', None)
            if status == 402 or '402' in str(e):
                banner = "Cartesia (Text to Speech) free tier exhausted. Please update your API key."
                print(f">>> Cartesia 402: TTS credits exhausted")
                await post_conversation_update(self._room_name, {"rate_limit_error": banner})
            raise


async def entrypoint(ctx: agents.JobContext):
    print(f"Agent connecting to room: {ctx.room.name}")
    await ctx.connect()

    # Wipe any stale data from a previous call on this room before doing anything else
    await post_conversation_update(ctx.room.name, {
        "patient": {},
        "manual_phone": "",
        "transcript": [],
        "slot_grid": None,
        "emergency_triggered": False,
        "emergency_option": "",
        "appointments_made": [],
        "conversation_stage": "GREETING",
        "has_injection": False,
        "injected_message": "",
    })

    db_url = os.getenv("SUPABASE_DB_URL", "")
    graph = await create_graph(db_url)

    room_graphs[ctx.room.name] = graph
    room_states[ctx.room.name] = {
        "thread_id": ctx.room.name,
        "is_first_turn": True,
        "processing": False,
        "last_transcript": "",
        "history": [],
        "tokens_used": 0,
        "started_at": datetime.now().isoformat(),
        "patient": {},
        "appointment_slip": {},
        "appointments_checked": False,
        "pending_confirmation": False,
    }

    # Phone-number accumulation state (closure vars, one per room session)
    _phone_debounce_task: list = [None]
    _phone_pending: list = []

    _PHONE_KEYWORDS = ("phone number", "10-digit", "mobile", "contact number", "digit")
    _NAME_KEYWORDS  = ("your name", "may i know", "know your name", "what is your name",
                       "what's your name", "say it out loud or type it in the box on screen")
    # Spoken digit words used to count how many digits the user has said
    _DIGIT_WORDS = frozenset({
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "oh",
    })
    _PHONE_FALLBACK_SECS = 5.0   # fire after this silence even if < 10 digits
    _NAME_DEBOUNCE_SECS  = 1.2   # wait for trailing words like "My name is [pause] Ritwik"

    _name_debounce_task: list = [None]
    _name_pending: list = []

    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            language="en-IN",
            endpointing_ms=100,   # 100ms balances speed vs accuracy (default 25ms too aggressive)
        ),
        tts=create_tts(),
        vad=silero.VAD.load(
            min_silence_duration=0.6,       # wait 0.6 s of silence before ending turn
            activation_threshold=0.35,      # lower = more sensitive (catches short quiet words)
            deactivation_threshold=0.2,     # keep capturing even if confidence dips mid-word
            prefix_padding_duration=0.3,    # include 300ms before speech onset
        ),
        turn_handling={"interruption": {"enabled": False}},
    )

    def _is_phone_collection_stage() -> bool:
        history = room_states.get(ctx.room.name, {}).get("history", [])
        for msg in reversed(history):
            if msg.get("role") == "assistant":
                last = msg.get("content", "").lower()
                return any(kw in last for kw in _PHONE_KEYWORDS)
        return False

    def _is_name_collection_stage() -> bool:
        history = room_states.get(ctx.room.name, {}).get("history", [])
        # Only the very first assistant turn asks for name
        for msg in reversed(history):
            if msg.get("role") == "assistant":
                last = msg.get("content", "").lower()
                return any(kw in last for kw in _NAME_KEYWORDS)
        return False

    def _count_digit_words(t: str) -> int:
        return sum(1 for w in re.sub(r"[^\w\s]", "", t.lower()).split() if w in _DIGIT_WORDS)

    def _fire_phone(combined: str):
        """Send the accumulated phone transcript to the handler."""
        last = room_states.get(ctx.room.name, {}).get("last_transcript", "")
        if combined == last:
            return
        room_states[ctx.room.name]["last_transcript"] = combined
        print(f">>> FINAL transcript (phone): {combined}")
        asyncio.create_task(handle_user_speech(ctx, session, combined))

    def on_user_speech(user_msg):
        try:
            # Only process final transcripts
            is_final = getattr(user_msg, 'is_final', True)
            if not is_final:
                _interim_text = getattr(user_msg, 'transcript', None) or getattr(user_msg, 'content', '')
                if _interim_text and _interim_text.strip():
                    print(f">>> Interim: '{_interim_text.strip()[:60]}'")
                return

            text = ""
            if hasattr(user_msg, 'transcript'):
                text = user_msg.transcript
            elif hasattr(user_msg, 'content'):
                text = user_msg.content
            else:
                text = str(user_msg)

            text = text.strip()

            # Skip empty or very short
            if not text or len(text) < 3:
                return

            if _is_phone_collection_stage():
                # Accumulate chunks until we have 10 digit-words (a complete
                # Indian phone number), regardless of how slowly the user speaks.
                _phone_pending.append(text)
                combined = " ".join(_phone_pending)
                digit_count = _count_digit_words(combined)
                print(f">>> [Phone] {digit_count} digits so far: {combined[:70]}")

                # Cancel any running fallback timer
                if _phone_debounce_task[0] and not _phone_debounce_task[0].done():
                    _phone_debounce_task[0].cancel()

                if digit_count >= 10:
                    # Have a complete number — fire immediately
                    _phone_pending.clear()
                    _fire_phone(combined)
                else:
                    # Still incomplete — wait for more speech, fire after silence
                    async def _fallback():
                        await asyncio.sleep(_PHONE_FALLBACK_SECS)
                        chunks = _phone_pending.copy()
                        _phone_pending.clear()
                        if chunks:
                            _fire_phone(" ".join(chunks))

                    _phone_debounce_task[0] = asyncio.create_task(_fallback())
                return

            if _is_name_collection_stage():
                # Buffer name fragments so "My name is [pause] Ritwik" arrives
                # as one combined turn instead of two separate ones.
                _name_pending.append(text)
                if _name_debounce_task[0] and not _name_debounce_task[0].done():
                    _name_debounce_task[0].cancel()

                async def _flush_name():
                    await asyncio.sleep(_NAME_DEBOUNCE_SECS)
                    chunks = _name_pending.copy()
                    _name_pending.clear()
                    combined = " ".join(chunks)
                    last = room_states.get(ctx.room.name, {}).get("last_transcript", "")
                    if combined == last:
                        return
                    room_states[ctx.room.name]["last_transcript"] = combined
                    print(f">>> FINAL transcript (name): {combined}")
                    asyncio.create_task(handle_user_speech(ctx, session, combined))

                _name_debounce_task[0] = asyncio.create_task(_flush_name())
                return

            # Normal flow — process immediately
            last = room_states.get(ctx.room.name, {}).get("last_transcript", "")
            if text == last:
                return

            room_states[ctx.room.name]["last_transcript"] = text
            print(f">>> FINAL transcript: {text}")
            asyncio.create_task(handle_user_speech(ctx, session, text))

        except Exception as e:
            print(f">>> on_user_speech error: {e}")

    session.on("user_input_transcribed")(on_user_speech)

    await session.start(
        room=ctx.room,
        agent=VoiceDeskAgent(
            room_name=ctx.room.name,
            instructions="You are VoiceDesk, a healthcare assistant.",
        ),
    )

    print(f"VoiceDesk agent started in room: {ctx.room.name}")

    asyncio.create_task(poll_for_injections(ctx, session))

    greeting = (
        "Hello! Welcome to VoiceDesk, your healthcare assistant. "
        "May I know your full name please? You can say it out loud or type it in the box on screen."
    )
    initial_history = [{"role": "assistant", "content": greeting}]
    room_states[ctx.room.name]["history"] = initial_history
    await post_conversation_update(
        ctx.room.name,
        {
            "last_response": greeting,
            "conversation_stage": "GREETING",
            "current_intent": "",
            "tokens_used": 0,
            "cost_usd": 0.0,
            "appointments_made": [],
            "tools_called": [],
            "patient": {},
            "transcript": initial_history,
            "manual_phone": "",
        },
    )
    await session.say(greeting, allow_interruptions=False)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            api_key=os.getenv("LIVEKIT_API_KEY"),
            api_secret=os.getenv("LIVEKIT_API_SECRET"),
            ws_url=os.getenv("LIVEKIT_URL"),
        )
    )
