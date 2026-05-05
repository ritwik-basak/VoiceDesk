from datetime import date, timedelta
from typing import Optional

from app.db import supabase_client

TIME_SLOTS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"]


# ------------------------------------------------------------------
# Users
# ------------------------------------------------------------------

async def get_or_create_user(phone_number: str, name: Optional[str] = None) -> dict:
    try:
        res = supabase_client.table("users").select("*").eq("phone_number", phone_number).execute()
        if res.data:
            user = res.data[0]
            if name and not user.get("name"):
                updated = (
                    supabase_client.table("users")
                    .update({"name": name})
                    .eq("phone_number", phone_number)
                    .execute()
                )
                return updated.data[0]
            return user

        inserted = supabase_client.table("users").insert({"phone_number": phone_number, "name": name}).execute()
        return inserted.data[0]
    except Exception as e:
        print(f"[get_or_create_user] Error for phone {phone_number}: {e}")
        raise


# ------------------------------------------------------------------
# Doctors
# ------------------------------------------------------------------

async def get_all_doctors() -> list[dict]:
    try:
        res = (
            supabase_client.table("doctors")
            .select("id, name, specialization, qualification, experience_years")
            .eq("is_available", True)
            .execute()
        )
        return res.data
    except Exception as e:
        print(f"[get_all_doctors] Error: {e}")
        raise


# ------------------------------------------------------------------
# Slots
# ------------------------------------------------------------------

async def fetch_slots_by_doctor(doctor_id: str) -> list[dict]:
    try:
        res = (
            supabase_client.table("available_slots")
            .select("id, slot_date, slot_time")
            .eq("doctor_id", doctor_id)
            .eq("is_available", True)
            .gte("slot_date", date.today().isoformat())
            .order("slot_date")
            .order("slot_time")
            .execute()
        )
        return res.data
    except Exception as e:
        print(f"[fetch_slots_by_doctor] Error for doctor {doctor_id}: {e}")
        raise


async def fetch_slot_status_by_doctor(doctor_id: str) -> list[dict]:
    try:
        start_date = date.today().isoformat()
        end_date = (date.today() + timedelta(days=7)).isoformat()
        res = (
            supabase_client.table("available_slots")
            .select("id, slot_date, slot_time, is_available")
            .eq("doctor_id", doctor_id)
            .gte("slot_date", start_date)
            .lte("slot_date", end_date)
            .order("slot_date")
            .order("slot_time")
            .execute()
        )
        return res.data
    except Exception as e:
        print(f"[fetch_slot_status_by_doctor] Error for doctor {doctor_id}: {e}")
        raise


# ------------------------------------------------------------------
# Appointments
# ------------------------------------------------------------------

async def book_appointment(
    phone_number: str,
    doctor_id: str,
    appointment_date: str,
    appointment_time: str,
) -> dict:
    try:
        user_res = supabase_client.table("users").select("id").eq("phone_number", phone_number).execute()
        if not user_res.data:
            raise ValueError(f"User not found for phone: {phone_number}")
        user_id = user_res.data[0]["id"]

        slot_res = (
            supabase_client.table("available_slots")
            .select("id, is_available")
            .eq("doctor_id", doctor_id)
            .eq("slot_date", appointment_date)
            .eq("slot_time", appointment_time)
            .execute()
        )
        if not slot_res.data:
            raise ValueError("Slot not found")
        slot = slot_res.data[0]
        if not slot["is_available"]:
            raise ValueError("Slot is already booked")

        appt_res = supabase_client.table("appointments").insert({
            "user_id": user_id,
            "doctor_id": doctor_id,
            "phone_number": phone_number,
            "appointment_date": appointment_date,
            "appointment_time": appointment_time,
            "status": "confirmed",
        }).execute()

        if not appt_res.data:
            raise ValueError("Failed to insert appointment")

        supabase_client.table("available_slots").update({"is_available": False}).eq("id", slot["id"]).execute()

        return appt_res.data[0]
    except Exception as e:
        print(f"[book_appointment] Error for phone {phone_number}: {e}")
        raise


async def get_appointments(phone_number: str) -> list[dict]:
    try:
        res = (
            supabase_client.table("appointments")
            .select("id, appointment_date, appointment_time, status, notes, doctors(name, specialization)")
            .eq("phone_number", phone_number)
            .neq("status", "cancelled")
            .order("appointment_date")
            .execute()
        )
        return res.data
    except Exception as e:
        print(f"[get_appointments] Error for phone {phone_number}: {e}")
        raise


async def cancel_appointment(phone_number: str, appointment_id: str) -> dict:
    try:
        appt_res = (
            supabase_client.table("appointments")
            .select("*")
            .eq("id", appointment_id)
            .eq("phone_number", phone_number)
            .execute()
        )
        if not appt_res.data:
            raise ValueError("Appointment not found")
        appt = appt_res.data[0]

        cancelled = (
            supabase_client.table("appointments")
            .update({"status": "cancelled"})
            .eq("id", appointment_id)
            .execute()
        )

        supabase_client.table("available_slots").update({"is_available": True}).eq(
            "doctor_id", appt["doctor_id"]
        ).eq("slot_date", appt["appointment_date"]).eq("slot_time", appt["appointment_time"]).execute()

        return cancelled.data[0]
    except Exception as e:
        print(f"[cancel_appointment] Error for appointment {appointment_id}: {e}")
        raise


async def modify_appointment(
    phone_number: str,
    appointment_id: str,
    new_date: str,
    new_time: str,
) -> dict:
    try:
        appt_res = (
            supabase_client.table("appointments")
            .select("*")
            .eq("id", appointment_id)
            .eq("phone_number", phone_number)
            .execute()
        )
        if not appt_res.data:
            raise ValueError("Appointment not found")
        appt = appt_res.data[0]

        new_slot_res = (
            supabase_client.table("available_slots")
            .select("id, is_available")
            .eq("doctor_id", appt["doctor_id"])
            .eq("slot_date", new_date)
            .eq("slot_time", new_time)
            .execute()
        )
        if not new_slot_res.data:
            raise ValueError("New slot not found")
        new_slot = new_slot_res.data[0]
        if not new_slot["is_available"]:
            raise ValueError("New slot is not available")

        # Free the old slot
        supabase_client.table("available_slots").update({"is_available": True}).eq(
            "doctor_id", appt["doctor_id"]
        ).eq("slot_date", appt["appointment_date"]).eq("slot_time", appt["appointment_time"]).execute()

        # Cancel the old appointment
        supabase_client.table("appointments").update({"status": "cancelled"}).eq("id", appointment_id).execute()

        # Book the new appointment
        new_appt_res = supabase_client.table("appointments").insert({
            "user_id": appt["user_id"],
            "doctor_id": appt["doctor_id"],
            "phone_number": phone_number,
            "appointment_date": new_date,
            "appointment_time": new_time,
            "status": "confirmed",
        }).execute()

        if not new_appt_res.data:
            raise ValueError("Failed to create modified appointment")

        # Lock the new slot
        supabase_client.table("available_slots").update({"is_available": False}).eq("id", new_slot["id"]).execute()

        return new_appt_res.data[0]
    except Exception as e:
        print(f"[modify_appointment] Error for appointment {appointment_id}: {e}")
        raise


# ------------------------------------------------------------------
# Conversations
# ------------------------------------------------------------------

async def save_conversation_summary(
    phone_number: str,
    summary: str,
    appointments: list,
    preferences: dict,
    cost_usd: float,
    tokens_used: int,
    started_at: str,
    ended_at: str,
) -> dict:
    try:
        res = supabase_client.table("conversations").insert({
            "phone_number": phone_number,
            "summary": summary,
            "appointments_made": appointments,
            "user_preferences": preferences,
            "cost_usd": cost_usd,
            "tokens_used": tokens_used,
            "started_at": started_at,
            "ended_at": ended_at,
        }).execute()
        return res.data[0]
    except Exception as e:
        print(f"[save_conversation_summary] Error for phone {phone_number}: {e}")
        raise


async def get_all_conversations(limit: int = 100) -> list[dict]:
    try:
        res = (
            supabase_client.table("conversations")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data
    except Exception as e:
        print(f"[get_all_conversations] Error: {e}")
        return []


async def get_conversation_by_id(conversation_id: str) -> dict | None:
    try:
        res = (
            supabase_client.table("conversations")
            .select("*")
            .eq("id", conversation_id)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"[get_conversation_by_id] Error: {e}")
        return None


# ------------------------------------------------------------------
# Self-healing slot replenishment
# ------------------------------------------------------------------

async def ensure_slots_exist(days_ahead: int = 14) -> None:
    """Generate slots for the next `days_ahead` days, filling only missing dates."""
    try:
        today     = date.today()
        today_str = today.isoformat()
        end_str   = (today + timedelta(days=days_ahead)).isoformat()

        doctors_res = supabase_client.table("doctors").select("id").execute()
        if not doctors_res.data:
            print("[ensure_slots_exist] No doctors found — skipping slot generation")
            return

        # Find which (doctor_id, slot_date) combos already exist in the window
        existing_res = (
            supabase_client.table("available_slots")
            .select("doctor_id, slot_date")
            .gte("slot_date", today_str)
            .lte("slot_date", end_str)
            .execute()
        )
        existing = {
            (r["doctor_id"], r["slot_date"])
            for r in (existing_res.data or [])
        }

        slots = []
        for doctor in doctors_res.data:
            for offset in range(1, days_ahead + 1):
                d = (today + timedelta(days=offset)).isoformat()
                if (doctor["id"], d) not in existing:
                    for slot_time in TIME_SLOTS:
                        slots.append({
                            "doctor_id": doctor["id"],
                            "slot_date": d,
                            "slot_time": slot_time,
                            "is_available": True,
                        })

        if slots:
            supabase_client.table("available_slots").insert(slots).execute()
            print(f"[ensure_slots_exist] Inserted {len(slots)} new slots")
        else:
            print("[ensure_slots_exist] All slots already exist — nothing to insert")
    except Exception as e:
        print(f"[ensure_slots_exist] Error: {e}")
        raise
