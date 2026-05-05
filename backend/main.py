import asyncio
import sys
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import os
import re
import traceback
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.agent import create_graph, run_conversation_turn
from app.db import supabase_client  # noqa: F401 — imported to verify connection on startup
from app.db.queries import ensure_slots_exist
from app.voice import generate_token, get_livekit_url
from langchain_core.messages import AIMessage, HumanMessage

app = FastAPI(title="Voice AI Backend")

conversation_updates: dict = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# TODO: Register routers here
# app.include_router(some_router, prefix="/api/v1")

voice_graph = None


async def _daily_slot_refresh():
    """Top up slots every 24 hours so future dates never go empty."""
    while True:
        await asyncio.sleep(24 * 60 * 60)
        try:
            await ensure_slots_exist(days_ahead=14)
        except Exception as e:
            print(f"[daily_slot_refresh] Error: {e}")


@app.on_event("startup")
async def startup():
    global voice_graph
    await ensure_slots_exist(days_ahead=14)
    voice_graph = await create_graph(os.environ["SUPABASE_DB_URL"])
    asyncio.create_task(_daily_slot_refresh())
    print("VoiceDesk multi-agent system ready")


# ------------------------------------------------------------------
# Request / Response models
# ------------------------------------------------------------------


class ConversationRequest(BaseModel):
    thread_id: str
    message: str
    is_first_turn: bool = False


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------


@app.post("/test-llm")
async def test_llm():
    try:
        from langchain_groq import ChatGroq
        llm = ChatGroq(
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            api_key=os.getenv("GROQ_API_KEY"),
            max_retries=3,
        )
        response = await llm.ainvoke("Say hello in one sentence")
        return {"response": response.content}
    except Exception as e:
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.get("/token")
async def get_token(room_name: str, participant_name: str):
    token = generate_token(room_name, participant_name)
    return {
        "token": token,
        "url": get_livekit_url(),
    }


@app.post("/voice/start")
async def voice_start(request: dict):
    room_name = request.get("room_name", "")
    participant_name = request.get("participant_name", "Guest")
    thread_id = room_name
    return {
        "thread_id": thread_id,
        "room_name": room_name,
        "status": "started",
    }


@app.post("/voice/stop")
async def voice_stop(request: dict):
    room_name = request.get("room_name", "")

    # Save incomplete call record if close_call/escalate_call didn't already save one.
    # Those functions set conversation_stage to "END" — if it's anything else the call
    # was cancelled before completing.
    state = conversation_updates.get(room_name, {})
    stage = state.get("conversation_stage", "GREETING")

    if room_name and stage != "END":
        try:
            from app.db.queries import save_conversation_summary
            from datetime import datetime as _dt
            import re as _re

            patient    = state.get("patient") or {}
            transcript = state.get("transcript", [])

            # Always extract name and phone from transcript first — the patient dict in
            # conversation_updates can be stale from a prior call on the same room.
            name  = ""
            phone = ""
            from app.tools.appointment_tools import _normalize_phone as _np
            _bad_names = {"patient's name", "patient name", "unknown", "name", "patient", ""}
            for msg in transcript:
                if msg.get("role") != "user":
                    continue
                content = msg.get("content", "")
                if not name:
                    m = _re.search(r"(?:my name is|i(?:'| a)m)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)", content, _re.IGNORECASE)
                    if m:
                        candidate = m.group(1).strip().title()
                        if candidate.lower() not in _bad_names:
                            name = candidate
                    elif not name:
                        words = content.strip().split()
                        if len(words) == 1 and words[0].isalpha() and words[0][0].isupper():
                            if words[0].lower() not in _bad_names:
                                name = words[0]
                if not phone:
                    extracted = _np(content)
                    if len(extracted) >= 10:
                        phone = extracted

            # Fall back to patient dict if transcript extraction missed anything
            if not name:
                name = patient.get("name", "")
                if name.lower().strip() in _bad_names:
                    name = ""
            if not phone:
                phone = patient.get("phone_number", "") or state.get("manual_phone", "")

            _em_option = state.get("emergency_option", "")
            _call_outcome = "completed" if _em_option == "ambulance" else "incomplete"
            _summary_prefix = "Ambulance dispatched" if _em_option == "ambulance" else "Incomplete call"
            await save_conversation_summary(
                phone_number=phone,
                summary=(
                    f"{_summary_prefix}. Patient: {name or 'Unknown'}. "
                    f"Stage reached: {stage}."
                ),
                appointments=[],
                preferences={
                    "patient_name":       name,
                    "call_outcome":       _call_outcome,
                    "escalation_reason":  "",
                    "doctor_booked":      "",
                    "appointment_date":   "",
                    "appointment_time":   "",
                    "transcript":         transcript,
                    "emergency_triggered": state.get("emergency_triggered", False),
                    "emergency_option":   state.get("emergency_option", ""),
                },
                cost_usd=round(float(state.get("cost_usd", 0.0)), 6),
                tokens_used=int(state.get("tokens_used", 0)),
                started_at=_dt.now().isoformat(),
                ended_at=_dt.now().isoformat(),
            )
            print(f">>> Incomplete call record saved for {room_name} — name={name}, phone={phone}, turns={len(transcript)}")
        except Exception as e:
            print(f">>> Failed to save incomplete call record: {e}")

    return {"status": "stopped"}


@app.get("/conversation-status/{room_name}")
async def get_conversation_status(room_name: str):
    return conversation_updates.get(room_name, {
        "last_response": "",
        "conversation_stage": "GREETING",
        "current_intent": "",
        "tokens_used": 0,
        "cost_usd": 0.0,
        "appointments_made": [],
        "tools_called": [],
    })


@app.post("/conversation-update")
async def update_conversation(request: dict):
    room_name = request.get("room_name", "")
    if room_name not in conversation_updates:
        conversation_updates[room_name] = {}
    conversation_updates[room_name].update(request)
    return {"status": "updated"}


@app.post("/voice/speak")
async def voice_speak(request: dict):
    room_name = request.get("room_name", "")
    text = request.get("text", "")
    if room_name and text and room_name in conversation_updates:
        conversation_updates[room_name]["tts_speak_text"] = text
    return {"status": "queued"}


@app.post("/inject-message")
async def inject_message(request: dict):
    room_name = request.get("room_name", "")
    message = request.get("message", "")
    if room_name in conversation_updates:
        conversation_updates[room_name]["injected_message"] = message
        conversation_updates[room_name]["has_injection"] = True
    return {"status": "injected"}


@app.post("/set-phone")
async def set_phone(request: dict):
    room_name = request.get("room_name", "")
    phone = request.get("phone", "")
    if room_name and phone:
        if room_name not in conversation_updates:
            conversation_updates[room_name] = {}
        conversation_updates[room_name]["manual_phone"] = phone
        print(f"Manual phone set for room {room_name}: {phone}")
        return {"status": "phone set", "phone": phone}
    return {"status": "error"}


@app.post("/set-name")
async def set_name(request: dict):
    room_name = request.get("room_name", "")
    name = request.get("name", "").strip()
    if room_name and name:
        if room_name not in conversation_updates:
            conversation_updates[room_name] = {}
        conversation_updates[room_name]["manual_name"] = name
        print(f"Manual name set for room {room_name}: {name}")
        return {"status": "name set", "name": name}
    return {"status": "error"}


@app.get("/doctors")
async def get_doctors_list():
    from app.db.queries import get_all_doctors
    doctors = await get_all_doctors()
    return {"doctors": doctors}


@app.post("/conversation")
async def conversation(request: ConversationRequest):
    initial_state = None

    if request.is_first_turn:
        initial_state = {
            "messages": [HumanMessage(content=request.message)],
            "phone_number": "",
            "user_name": "",
            "current_intent": "",
            "conversation_stage": "GREETING",
            "cost_usd": 0.0,
            "tokens_used": 0,
            "started_at": datetime.now().isoformat(),
            "appointments_made": [],
            "next_agent": "receptionist",
        }

    try:
        result = await asyncio.wait_for(
            run_conversation_turn(
                voice_graph,
                thread_id=request.thread_id,
                user_message=request.message,
                initial_state=initial_state,
            ),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Request timed out - agent took too long")
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"FULL ERROR:\n{error_details}")
        raise HTTPException(status_code=500, detail=error_details)

    last_ai_message = next(
        (
            msg.content
            for msg in reversed(result["messages"])
            if isinstance(msg, AIMessage)
        ),
        "",
    )

    return {
        "response": last_ai_message,
        "conversation_stage": result["conversation_stage"],
        "current_intent": result["current_intent"],
        "cost_usd": result["cost_usd"],
        "tokens_used": result["tokens_used"],
        "appointments_made": result["appointments_made"],
    }


SPECIALIZATION_FEES = {
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


@app.get("/analytics/earnings")
async def analytics_earnings():
    from app.db.queries import get_all_doctors
    from datetime import datetime as dt
    from supabase import create_client
    import os

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    # Fetch all confirmed appointments with doctor info
    res = sb.table("appointments") \
        .select("*, doctors(name, specialization)") \
        .eq("status", "confirmed") \
        .execute()

    appointments = res.data or []

    total_revenue = 0
    by_doctor     = {}
    by_month      = {}

    for appt in appointments:
        doctor_info = appt.get("doctors") or {}
        spec        = doctor_info.get("specialization", "")
        doc_name    = doctor_info.get("name", "Unknown")
        fees        = SPECIALIZATION_FEES.get(spec, {"consultation": 800, "registration": 150, "service": 75})
        total       = fees["consultation"] + fees["registration"] + fees["service"]
        total_revenue += total

        # Per-doctor
        if doc_name not in by_doctor:
            by_doctor[doc_name] = {
                "doctor": doc_name,
                "specialization": spec,
                "appointments": 0,
                "revenue": 0,
                "consultation_fee": fees["consultation"],
                "registration_fee": fees["registration"],
                "service_fee":      fees["service"],
                "total_per_appt":   total,
            }
        by_doctor[doc_name]["appointments"] += 1
        by_doctor[doc_name]["revenue"]      += total

        # Per-month
        date_str = str(appt.get("appointment_date", ""))
        try:
            month_key = dt.strptime(date_str, "%Y-%m-%d").strftime("%Y-%m")
        except Exception:
            month_key = "Unknown"
        by_month[month_key] = by_month.get(month_key, 0) + total

    # Ambulance dispatches — count conversations where emergency_option = 'ambulance'
    AMBULANCE_FEE = 3500
    try:
        amb_res = sb.table("conversations").select("user_preferences").execute()
        ambulance_dispatches = sum(
            1 for row in (amb_res.data or [])
            if (row.get("user_preferences") or {}).get("emergency_option") == "ambulance"
        )
    except Exception:
        ambulance_dispatches = 0
    ambulance_revenue = ambulance_dispatches * AMBULANCE_FEE

    return {
        "total_revenue":        total_revenue + ambulance_revenue,
        "total_appointments":   len(appointments),
        "by_doctor":            sorted(by_doctor.values(), key=lambda x: -x["revenue"]),
        "by_month":             [{"month": k, "revenue": v} for k, v in sorted(by_month.items())],
        "currency":             "INR",
        "ambulance_dispatches": ambulance_dispatches,
        "ambulance_revenue":    ambulance_revenue,
        "ambulance_fee":        AMBULANCE_FEE,
    }


@app.get("/graph-status")
async def graph_status():
    return {"status": "ready", "agents": ["receptionist", "booking", "summary"]}


@app.get("/health")
async def health():
    return {"status": "ok", "database": "connected"}


# ------------------------------------------------------------------
# Analytics endpoints
# ------------------------------------------------------------------

_WORD_TO_DIGIT = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
}

# Matches "double <word>" (e.g. "double five" = 55) or a single number word.
_NUM_TOKEN_RE = re.compile(
    r'\b(double\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)'
    r'|zero|one|two|three|four|five|six|seven|eight|nine)\b',
    re.IGNORECASE,
)

def _token_digits(tok_text: str) -> str:
    t = tok_text.lower().strip()
    if t.startswith('double'):
        d = _WORD_TO_DIGIT.get(t.split()[-1], '')
        return d * 2
    return _WORD_TO_DIGIT.get(t, '')

def _mask_phone(phone: str) -> str:
    if not phone or len(phone) < 6:
        return phone
    return phone[:-5] + 'XXXXX'

def _mask_phone_in_text(text: str, phone: str) -> str:
    if not phone or len(phone) < 6 or not text:
        return text

    # Replace exact digit string (e.g. AI echoes "9876543210")
    result = text.replace(phone, _mask_phone(phone))

    # Replace spoken form, handling "double X", punctuation gaps, varied groupings
    digits_target = ''.join(c for c in phone if c.isdigit())[-10:]
    if len(digits_target) != 10:
        return result

    toks = list(_NUM_TOKEN_RE.finditer(result))
    if len(toks) < 5:  # minimum 5 tokens if all are "double X"
        return result

    n = len(toks)
    for si in range(n):
        accum = ''
        for ei in range(si, min(si + 10, n)):
            # Reject if the gap between consecutive tokens contains any letter
            # (would mean unrelated words are in between)
            if ei > si:
                gap = result[toks[ei - 1].end():toks[ei].start()]
                if len(gap) > 20 or re.search(r'[a-zA-Z]', gap):
                    break
            accum += _token_digits(toks[ei].group(0))
            if len(accum) >= 10:
                if accum == digits_target:
                    run = toks[si:ei + 1]
                    # Find split point: keep tokens covering first 5 digits, mask rest
                    kept, split = 0, len(run)
                    for j, tok in enumerate(run):
                        d = len(_token_digits(tok.group(0)))
                        if kept + d > 5:
                            split = j   # straddles boundary — mask this token too
                            break
                        kept += d
                        if kept == 5:
                            split = j + 1
                            break
                    if split < len(run):
                        result = (result[:run[split].start()]
                                  + 'X X X X X'
                                  + result[run[-1].end():])
                    return result
                break  # 10 digits reached but no match, try next start
            elif len(accum) > 10:
                break
    return result


@app.get("/analytics/calls")
async def analytics_calls():
    from app.db.queries import get_all_conversations
    rows = await get_all_conversations(limit=200)
    calls = []
    for r in rows:
        prefs    = r.get("user_preferences") or {}
        phone    = r.get("phone_number", "")
        outcome  = prefs.get("call_outcome", "completed")
        duration = ""
        if r.get("started_at") and r.get("ended_at"):
            from datetime import datetime as _dt
            try:
                s = _dt.fromisoformat(r["started_at"])
                e = _dt.fromisoformat(r["ended_at"])
                secs = int((e - s).total_seconds())
                duration = f"{secs // 60:02d}:{secs % 60:02d}"
            except Exception:
                pass
        calls.append({
            "id":                  r.get("id", ""),
            "created_at":          r.get("created_at", ""),
            "phone_masked":        _mask_phone(phone),
            "patient_name":        prefs.get("patient_name", "—"),
            "doctor_booked":       prefs.get("doctor_booked", "—"),
            "appointment_date":    prefs.get("appointment_date", ""),
            "appointment_time":    prefs.get("appointment_time", ""),
            "outcome":             outcome,
            "escalation_reason":   prefs.get("escalation_reason", ""),
            "duration":            duration,
            "tokens_used":         r.get("tokens_used", 0),
            "cost_usd":            r.get("cost_usd", 0),
            "summary":             _mask_phone_in_text(r.get("summary", ""), phone),
            "emergency_triggered": prefs.get("emergency_triggered", False),
            "emergency_option":    prefs.get("emergency_option", ""),
        })
    return {"calls": calls, "total": len(calls)}


@app.get("/analytics/calls/{conversation_id}")
async def analytics_call_detail(conversation_id: str):
    from app.db.queries import get_conversation_by_id
    row = await get_conversation_by_id(conversation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Call not found")
    prefs    = row.get("user_preferences") or {}
    phone    = row.get("phone_number", "")
    raw_transcript = prefs.get("transcript", [])
    transcript = [
        {"role": msg.get("role", ""), "content": _mask_phone_in_text(msg.get("content", ""), phone)}
        for msg in raw_transcript
    ]
    return {
        "id":                conversation_id,
        "phone_masked":      _mask_phone(phone),
        "patient_name":      prefs.get("patient_name", "—"),
        "doctor_booked":     prefs.get("doctor_booked", "—"),
        "appointment_date":  prefs.get("appointment_date", ""),
        "appointment_time":  prefs.get("appointment_time", ""),
        "outcome":           prefs.get("call_outcome", "completed"),
        "escalation_reason": prefs.get("escalation_reason", ""),
        "tokens_used":       row.get("tokens_used", 0),
        "cost_usd":          row.get("cost_usd", 0),
        "summary":           _mask_phone_in_text(row.get("summary", ""), phone),
        "started_at":        row.get("started_at", ""),
        "ended_at":          row.get("ended_at", ""),
        "transcript":        transcript,
    }
