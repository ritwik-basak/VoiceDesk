-- ============================================================
-- VoiceDesk Database Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT        UNIQUE NOT NULL,
    name         TEXT,
    created_at   TIMESTAMP   DEFAULT NOW()
);

-- ------------------------------------------------------------
-- doctors
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
    id               UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             TEXT      NOT NULL,
    specialization   TEXT      NOT NULL,
    qualification    TEXT      NOT NULL,
    experience_years INTEGER   NOT NULL,
    is_available     BOOLEAN   DEFAULT TRUE,
    created_at       TIMESTAMP DEFAULT NOW()
);

-- ------------------------------------------------------------
-- available_slots
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS available_slots (
    id           UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    doctor_id    UUID    REFERENCES doctors(id) ON DELETE CASCADE,
    slot_date    DATE    NOT NULL,
    slot_time    TIME    NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    UNIQUE (doctor_id, slot_date, slot_time)
);

-- ------------------------------------------------------------
-- appointments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id               UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID      REFERENCES users(id) ON DELETE SET NULL,
    doctor_id        UUID      REFERENCES doctors(id) ON DELETE SET NULL,
    phone_number     TEXT      NOT NULL,
    appointment_date DATE      NOT NULL,
    appointment_time TIME      NOT NULL,
    status           TEXT      DEFAULT 'confirmed',
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT NOW()
);

-- Partial unique index: only one confirmed booking per doctor per slot
CREATE UNIQUE INDEX IF NOT EXISTS no_double_booking
    ON appointments (doctor_id, appointment_date, appointment_time)
    WHERE status = 'confirmed';

-- ------------------------------------------------------------
-- conversations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id                 UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number       TEXT,
    summary            TEXT,
    appointments_made  JSONB,
    user_preferences   JSONB,
    cost_usd           NUMERIC,
    tokens_used        INTEGER,
    started_at         TIMESTAMP,
    ended_at           TIMESTAMP,
    created_at         TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- Seed: Doctors + Available Slots (next 7 days)
-- ============================================================

WITH inserted_doctors AS (
    INSERT INTO doctors (name, specialization, qualification, experience_years) VALUES
        ('Dr. Anil Sharma',   'General Physician',    'MBBS, MD (General Medicine)',                                              15),
        ('Dr. Priya Mehta',   'Dermatologist',         'MBBS, MD (Dermatology), Fellowship in Cosmetic Dermatology',              12),
        ('Dr. Rohan Das',     'Orthopedic Surgeon',    'MBBS, MS (Orthopedics), Fellowship in Joint Replacement',                 18),
        ('Dr. Sneha Iyer',    'Pediatrician',          'MBBS, MD (Pediatrics), Fellowship in Neonatal Care',                     10),
        ('Dr. Arjun Kapoor',  'Cardiologist',          'MBBS, MD (Cardiology), DM (Interventional Cardiology)',                  20),
        ('Dr. Meera Nair',    'Gynecologist',          'MBBS, MS (Obstetrics & Gynecology), Fellowship in Laparoscopic Surgery', 14),
        ('Dr. Vikram Bose',   'Neurologist',           'MBBS, MD (Neurology), DM (Neurology), Fellowship in Stroke Medicine',    16),
        ('Dr. Kavita Rao',    'ENT Specialist',        'MBBS, MS (ENT), Fellowship in Head & Neck Surgery',                      11),
        ('Dr. Sameer Joshi',  'Psychiatrist',          'MBBS, MD (Psychiatry), Fellowship in Child & Adolescent Psychiatry',     13),
        ('Dr. Ananya Singh',  'Ophthalmologist',       'MBBS, MS (Ophthalmology), Fellowship in Retinal Surgery',                 9)
    ON CONFLICT DO NOTHING
    RETURNING id
)
INSERT INTO available_slots (doctor_id, slot_date, slot_time)
SELECT
    d.id,
    (CURRENT_DATE + s.day_offset)::DATE,
    t.slot_time::TIME
FROM inserted_doctors d
CROSS JOIN generate_series(1, 7) AS s(day_offset)
CROSS JOIN (
    VALUES
        ('09:00'::TIME),
        ('10:00'::TIME),
        ('11:00'::TIME),
        ('14:00'::TIME),
        ('15:00'::TIME),
        ('16:00'::TIME)
) AS t(slot_time)
ON CONFLICT DO NOTHING;
