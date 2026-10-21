-- ============================================================
-- Phone Charging Tracking System — Database Schema
-- ============================================================
-- Run once against your PostgreSQL database to initialise.
-- Example: psql -d charging_tracker -f schema.sql
-- ============================================================

-- Staff / attendants
CREATE TABLE IF NOT EXISTS staff_users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    username    TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'attendant' CHECK (role IN ('owner', 'attendant')),
    password_hash TEXT NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Charging jobs (one per charging-card registration)
CREATE TABLE IF NOT EXISTS charging_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    charging_number     TEXT NOT NULL,
    customer_name       TEXT NOT NULL,
    contact_optional    TEXT,
    face_image_path     TEXT,        -- server-side path or reference; NULL until captured
    face_consent_at     TIMESTAMPTZ, -- timestamp when customer gave consent
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'partial', 'closed')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID REFERENCES staff_users(id),
    closed_at           TIMESTAMPTZ,
    notes               TEXT
);

-- Enforce: only one active (or partial) job per charging number at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_charging_number
    ON charging_jobs (charging_number)
    WHERE status IN ('active', 'partial');

-- Devices attached to a job
CREATE TABLE IF NOT EXISTS devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES charging_jobs(id) ON DELETE CASCADE,
    device_type         TEXT NOT NULL,    -- e.g. "Phone", "Tablet"
    brand_model         TEXT NOT NULL,
    colour              TEXT NOT NULL,
    identifier_optional TEXT,             -- serial / IMEI if provided
    condition_notes     TEXT,
    accessories         TEXT,             -- e.g. "charger, case"
    status              TEXT NOT NULL DEFAULT 'in_shop'
                            CHECK (status IN ('in_shop', 'collected')),
    added_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by            UUID REFERENCES staff_users(id),
    collected_at        TIMESTAMPTZ,
    collected_by        UUID REFERENCES staff_users(id)
);

-- Audit log — every significant event
CREATE TABLE IF NOT EXISTS audit_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES charging_jobs(id),
    device_id   UUID REFERENCES devices(id),
    staff_id    UUID REFERENCES staff_users(id),
    event_type  TEXT NOT NULL,  -- e.g. 'job_created', 'device_added', 'device_collected', 'job_closed'
    event_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes       TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_charging_number ON charging_jobs (charging_number);
CREATE INDEX IF NOT EXISTS idx_jobs_status          ON charging_jobs (status);
CREATE INDEX IF NOT EXISTS idx_devices_job_id       ON devices (job_id);
CREATE INDEX IF NOT EXISTS idx_audit_job_id         ON audit_events (job_id);

-- ============================================================
-- Seed a default owner account (change password immediately!)
-- Password: Admin1234
-- ============================================================
INSERT INTO staff_users (display_name, username, role, password_hash)
VALUES (
    'Shop Owner',
    'admin',
    'owner',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lkq.' -- Admin1234
)
ON CONFLICT (username) DO NOTHING;
