import difflib
import re
from datetime import datetime, date, timedelta

from langchain_core.tools import tool

from app.db.queries import (
    book_appointment as db_book_appointment,
    cancel_appointment as db_cancel_appointment,
    fetch_slots_by_doctor,
    get_all_doctors,
    get_appointments,
    get_or_create_user,
    save_conversation_summary,
)


def _strip_title(name: str) -> str:
    return re.sub(r'^(doctor|dr\.?)\s+', '', name.lower()).strip()


_VALID_TIMES = {"09:00", "10:00", "11:00", "14:00", "15:00", "16:00"}
_VALID_TIMES_HUMAN = "9:00 AM, 10:00 AM, 11:00 AM, 2:00 PM, 3:00 PM, 4:00 PM"
_MAX_DAYS_AHEAD = 14

_HOUR_WORDS = {
    'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
    'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8,
}

def _normalize_time(time_str: str) -> str | None:
    """Convert spoken/written time to HH:MM. Returns None if unparseable."""
    t = time_str.strip().upper()
    if re.match(r'^\d{2}:\d{2}$', t):
        return t
    m = re.match(r'^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$', t)
    if m:
        hour   = int(m.group(1))
        minute = int(m.group(2) or '0')
        period = m.group(3)
        if period == 'PM' and hour != 12:
            hour += 12
        elif period == 'AM' and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}"
    # Handle word-form hours: "nine AM", "ten AM", "two PM", etc.
    t_low = time_str.strip().lower()
    m2 = re.match(r'^([a-z]+)\s*(am|pm)$', t_low)
    if m2:
        word, period = m2.group(1), m2.group(2).upper()
        if word in _HOUR_WORDS:
            hour = _HOUR_WORDS[word]
            if period == 'PM' and hour != 12:
                hour += 12
            elif period == 'AM' and hour == 12:
                hour = 0
            return f"{hour:02d}:00"
    return None


_WORD_DIGIT = {
    'zero': '0', 'oh': '0',
    'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
    'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
}

def _parse_spoken_phone(text: str) -> str:
    """Convert spoken phone number to digit string.
    Handles word digits, 'double X', 'triple X', commas, spaces.
    """
    t = text.lower().strip()
    t = re.sub(r'\bdouble\s+(\w+)', lambda m: f"{m.group(1)} {m.group(1)}", t)
    t = re.sub(r'\btriple\s+(\w+)', lambda m: f"{m.group(1)} {m.group(1)} {m.group(1)}", t)
    digits = []
    for token in re.split(r'[\s,\-\.]+', t):
        token = token.strip()
        if token in _WORD_DIGIT:
            digits.append(_WORD_DIGIT[token])
        elif token.isdigit():
            digits.append(token)
    return ''.join(digits)


def _normalize_phone(phone_number: str) -> str:
    """Extract digits; fall back to spoken-word parser if needed."""
    direct = re.sub(r'\D', '', phone_number)
    if len(direct) >= 10:
        # Strip Indian country code prefix to get exactly 10 digits
        if len(direct) == 12 and direct.startswith("91"):
            direct = direct[2:]
        elif len(direct) == 11 and direct.startswith("0"):
            direct = direct[1:]
        return direct
    return _parse_spoken_phone(phone_number)


def find_doctor_fuzzy(doctor_name: str, doctors: list) -> dict | None:
    """Return the best-matching doctor, tolerating STT mis-hearings and typos."""
    if not doctor_name or not doctors:
        return None
    query = _strip_title(doctor_name)
    for d in doctors:
        if _strip_title(d["name"]) == query:
            return d
    for d in doctors:
        db = _strip_title(d["name"])
        if query in db or db in query:
            return d
    db_names = [_strip_title(d["name"]) for d in doctors]
    matches = difflib.get_close_matches(query, db_names, n=1, cutoff=0.6)
    if matches:
        return doctors[db_names.index(matches[0])]
    return None


# ── Receptionist tools ────────────────────────────────────────────────────────

@tool
async def identify_user(phone_number: str, name: str) -> str:
    """Identify or create a user by their phone number and name."""
    phone_number = _normalize_phone(phone_number or "")
    if len(phone_number) < 10:
        return "ERROR: Cannot identify user without a valid 10-digit phone number. Ask the patient for their phone number first."
    try:
        user = await get_or_create_user(phone_number, name)
        display_name = user.get("name") or name
        return f"User identified: {display_name} ({phone_number})"
    except Exception as e:
        print(f"[identify_user] Error: {e}")
        return f"Could not identify user with phone {phone_number}. Please try again."


@tool
async def get_patient_profile(phone_number: str) -> str:
    """
    Retrieve full patient profile including appointment history, returning-patient
    status, and last visited doctor. Used by the Receptionist to personalise greeting
    and triage the call.
    """
    try:
        appointments = await get_appointments(phone_number)
        if not appointments:
            return "NEW_PATIENT: No previous appointments found. Treat as a new patient."

        total = len(appointments)
        last  = appointments[0]  # most recent first
        doctor_info = last.get("doctors") or {}
        last_doctor = doctor_info.get("name", "Unknown Doctor")
        last_date   = last.get("appointment_date", "")
        last_time   = str(last.get("appointment_time", ""))[:5]
        last_status = last.get("status", "")

        upcoming = [a for a in appointments if a.get("status") == "confirmed"]
        has_upcoming = len(upcoming) > 0
        upcoming_info = ""
        if has_upcoming:
            u = upcoming[0]
            ud = u.get("doctors") or {}
            upcoming_info = (
                f" | UPCOMING: {ud.get('name','?')} on "
                f"{u.get('appointment_date','')} at {str(u.get('appointment_time',''))[:5]}"
                f" (ID: {u.get('id','')})"
            )

        return (
            f"RETURNING_PATIENT: {total} visit(s) on record. "
            f"Last visit: {last_doctor} on {last_date} at {last_time} [{last_status}]"
            f"{upcoming_info}"
        )
    except Exception as e:
        print(f"[get_patient_profile] Error: {e}")
        return "Could not retrieve patient profile."


@tool
async def get_doctors() -> str:
    """Retrieve the list of all available doctors with their specializations."""
    try:
        doctors = await get_all_doctors()
        if not doctors:
            return "No doctors are currently available."
        lines = ["Available doctors:"]
        for i, d in enumerate(doctors, start=1):
            lines.append(f"  {i}. {d['name']} - {d['specialization']} | {d['experience_years']} yrs exp")
        return "\n".join(lines)
    except Exception as e:
        print(f"[get_doctors] Error: {e}")
        return "Could not retrieve doctor list at this time."


# ── Booking tools ─────────────────────────────────────────────────────────────

@tool
async def fetch_slots(doctor_name: str) -> str:
    """Fetch available appointment slots for a doctor by their name."""
    try:
        doctors = await get_all_doctors()
        doctor  = find_doctor_fuzzy(doctor_name, doctors)
        if not doctor:
            return (
                f"Doctor '{doctor_name}' not found. "
                "Please ask the patient to repeat the doctor's name clearly."
            )
        slots = await fetch_slots_by_doctor(doctor["id"])
        if not slots:
            return f"No available slots for {doctor['name']} at this time."

        dates = sorted({str(s["slot_date"]) for s in slots})
        earliest = dates[0]
        latest   = dates[-1]
        return (
            f"Slots loaded for {doctor['name']}. "
            f"{len(slots)} slot(s) available between {earliest} and {latest}. "
            f"Full calendar is displayed on screen for the patient to choose."
        )
    except Exception as e:
        print(f"[fetch_slots] Error: {e}")
        return f"Could not fetch slots for {doctor_name}."


@tool
async def find_earliest_available(doctor_name: str) -> str:
    """
    Find the single earliest available slot for a doctor. Used by the Booking
    Agent to proactively suggest the next available slot rather than making the
    patient browse the full calendar.
    """
    try:
        doctors = await get_all_doctors()
        doctor  = find_doctor_fuzzy(doctor_name, doctors)
        if not doctor:
            return f"Doctor '{doctor_name}' not found."

        slots = await fetch_slots_by_doctor(doctor["id"])
        if not slots:
            return f"No available slots for {doctor['name']} at this time."

        earliest = slots[0]  # already ordered by date then time
        slot_date = str(earliest["slot_date"])
        slot_time = str(earliest["slot_time"])[:5]
        return (
            f"Earliest available slot for {doctor['name']}: "
            f"{slot_date} at {slot_time}"
        )
    except Exception as e:
        print(f"[find_earliest_available] Error: {e}")
        return "Could not find earliest slot."


@tool
async def check_appointment_conflict(phone_number: str, proposed_date: str) -> str:
    """
    Check whether the patient already has a confirmed appointment on the proposed
    date. Called by the Booking Agent before confirming a new slot to prevent
    double-booking the patient's own schedule.
    """
    try:
        appointments = await get_appointments(phone_number)
        conflicts = [
            a for a in appointments
            if str(a.get("appointment_date", "")) == proposed_date
            and a.get("status") == "confirmed"
        ]
        if not conflicts:
            return f"No conflict: patient has no confirmed appointment on {proposed_date}."

        c = conflicts[0]
        doc = (c.get("doctors") or {}).get("name", "Unknown Doctor")
        t   = str(c.get("appointment_time", ""))[:5]
        return (
            f"CONFLICT: Patient already has a confirmed appointment with {doc} "
            f"at {t} on {proposed_date}. Inform the patient and ask if they still "
            f"want to book another appointment on the same day."
        )
    except Exception as e:
        print(f"[check_appointment_conflict] Error: {e}")
        return "Could not check for conflicts."


@tool
async def book_appointment(
    phone_number: str,
    doctor_name: str,
    date: str,
    time: str,
) -> str:
    """Book an appointment for a patient with a specific doctor on a given date and time."""
    try:
        # Validate time
        normalized_time = _normalize_time(time)
        if normalized_time not in _VALID_TIMES:
            return (
                f"'{time}' is not a valid appointment time. "
                f"Available times are: {_VALID_TIMES_HUMAN}. "
                "Please ask the patient to choose one of these times."
            )

        # Validate date is within bookable window
        try:
            from datetime import date as _date_cls
            appt_date = _date_cls.fromisoformat(date)
            today     = _date_cls.today()
            if appt_date <= today:
                return "Cannot book appointments for today or past dates. Please ask the patient to choose a future date from the slot calendar."
            if appt_date > today + timedelta(days=_MAX_DAYS_AHEAD):
                return f"Appointments can only be booked up to {_MAX_DAYS_AHEAD} days in advance. Please ask the patient to choose a date shown on the slot calendar."
        except ValueError:
            return f"Invalid date '{date}'. Please use YYYY-MM-DD format."

        doctors = await get_all_doctors()
        doctor  = find_doctor_fuzzy(doctor_name, doctors)
        if not doctor:
            return (
                f"Doctor '{doctor_name}' not found. "
                "Please ask the patient to repeat the doctor's name clearly."
            )
        await db_book_appointment(
            phone_number=phone_number,
            doctor_id=doctor["id"],
            appointment_date=date,
            appointment_time=normalized_time,
        )
        return f"Appointment confirmed! {doctor['name']} on {date} at {time}"
    except ValueError as e:
        error = str(e).lower()
        if "already booked" in error or "double" in error:
            return (
                "BOOKING FAILED: This slot is already taken or patient has a conflicting booking. "
                "Do NOT call get_doctors. Do NOT call retrieve_appointments. Do NOT list doctors. "
                "Stay on the slot calendar. Tell the patient: "
                "'Sorry, that slot is not available. Please choose a different date or time "
                "from the calendar shown on screen.'"
            )
        if "not found" in error or "slot" in error:
            return (
                "That time slot does not exist for this doctor. "
                "Valid times are 9:00 AM, 10:00 AM, 11:00 AM, 2:00 PM, 3:00 PM, and 4:00 PM. "
                "Please ask the patient to choose one of the available slots shown on screen."
            )
        return f"Could not book appointment: {e}"
    except Exception as e:
        print(f"[book_appointment] Error: {e}")
        return "Could not book appointment at this time. Please try again."


@tool
async def retrieve_appointments(phone_number: str) -> str:
    """Retrieve all upcoming appointments for a patient by their phone number."""
    phone_number = _normalize_phone(phone_number or "")
    if len(phone_number) < 10:
        return "ERROR: Cannot retrieve appointments without a valid 10-digit phone number. Ask the patient for their phone number first."
    try:
        appointments = await get_appointments(phone_number)
        if not appointments:
            return "No appointments found for this number."
        lines = ["Your upcoming appointments:"]
        for i, appt in enumerate(appointments, start=1):
            doctor_info = appt.get("doctors") or {}
            doc_name    = doctor_info.get("name", "Unknown Doctor")
            spec        = doctor_info.get("specialization", "")
            lines.append(
                f"  {i}. {doc_name} ({spec}) — "
                f"{appt['appointment_date']} at {str(appt['appointment_time'])[:5]} "
                f"[{appt['status']}] (ID: {appt['id']})"
            )
        return "\n".join(lines)
    except Exception as e:
        print(f"[retrieve_appointments] Error: {e}")
        return "Could not retrieve appointments at this time."


@tool
async def cancel_appointment(phone_number: str, appointment_id: str) -> str:
    """Cancel an existing appointment by its ID for a patient."""
    try:
        await db_cancel_appointment(phone_number, appointment_id)
        return "Appointment cancelled successfully."
    except ValueError:
        return "Appointment not found."
    except Exception as e:
        print(f"[cancel_appointment] Error: {e}")
        return "Could not cancel the appointment at this time."


# ── Summary tools ─────────────────────────────────────────────────────────────

@tool
async def end_conversation(
    phone_number: str,
    summary: str,
    preferences: str,
    call_outcome: str = "completed",
    quality_score: int = 5,
) -> str:
    """
    Save a structured conversation summary and close the session.
    quality_score: 1-5 rating of call resolution quality.
    call_outcome: 'completed', 'cancelled', 'no_action', 'escalated'.
    """
    try:
        now = datetime.now().isoformat()
        await save_conversation_summary(
            phone_number=phone_number,
            summary=summary,
            appointments=[],
            preferences={
                "notes": preferences,
                "call_outcome": call_outcome,
                "quality_score": quality_score,
                "recorded_at": now,
            },
            cost_usd=0.0,
            tokens_used=0,
            started_at=now,
            ended_at=now,
        )
        return f"Session closed. Outcome: {call_outcome}. Quality score: {quality_score}/5."
    except Exception as e:
        print(f"[end_conversation] Error: {e}")
        return "Conversation ended. Summary could not be saved."
