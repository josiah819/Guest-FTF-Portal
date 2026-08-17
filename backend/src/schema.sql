-- WoodsVoice schema. Idempotent: runs on every boot.
--
-- ⚠️ STATEMENT ORDER IS LOAD-BEARING. Upgrade guards (DO $$ renames, ADD COLUMN
-- IF NOT EXISTS) run BEFORE the matching CREATE TABLE IF NOT EXISTS so that
-- fresh installs create the final shape and existing installs converge to it.
-- Dependencies: roles → users → departments → user_departments → categories →
-- locations → submissions → submission_events. Insert new statements with care.

-- ===== v2 upgrade: admins → users (must precede CREATE TABLE users) =====
-- Postgres keeps FK constraints valid across RENAME (they bind by OID), so
-- submission_events' FK follows automatically. Old constraint/sequence names
-- (admins_pkey, admins_id_seq) survive — cosmetic only.
DO $$ BEGIN
  IF to_regclass('public.admins') IS NOT NULL AND to_regclass('public.users') IS NULL THEN
    ALTER TABLE admins RENAME TO users;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS roles (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  is_system  BOOLEAN NOT NULL DEFAULT false,   -- Administrator: undeletable, permissions locked
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  perm    TEXT NOT NULL,
  PRIMARY KEY (role_id, perm)
);

CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL DEFAULT 'Staff',
  email                TEXT NOT NULL DEFAULT '',
  password_hash        TEXT NOT NULL,
  role_id              INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  active               BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Upgrades: the renamed admins table lacks the v2 columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
-- v3: invite-based onboarding + Google sign-in. Google-only accounts have no
-- password; google_sub is Google's stable subject id, linked on first sign-in.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
-- One account per email. Guarded: a legacy install with duplicate emails must
-- still boot — it just misses the index until the duplicates are cleaned up.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email)) WHERE email <> '';
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'users_email_key skipped: duplicate emails exist';
END $$;

-- Pending invitations. The link token is stored hashed; the plain token lives
-- only in the invite email (and the one-time copy link shown after sending).
-- Role delete cascades — an invite for a vanished role is meaningless.
CREATE TABLE IF NOT EXISTS invites (
  id               SERIAL PRIMARY KEY,
  email            TEXT NOT NULL,
  role_id          INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  department_ids   INTEGER[] NOT NULL DEFAULT '{}',
  token_hash       TEXT NOT NULL UNIQUE,
  invited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  email                 TEXT NOT NULL DEFAULT '',
  active                BOOLEAN NOT NULL DEFAULT true,
  sort                  INTEGER NOT NULL DEFAULT 0,
  -- Weekly hours: {"mon":["08:00","20:00"],…,"sun":null}. NULL column = always open (24/7).
  hours                 JSONB,
  -- What happens to submissions that arrive while closed.
  after_hours           TEXT NOT NULL DEFAULT 'urgency_based',  -- hold | reroute | urgency_based
  fallback_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  on_call_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- Per-department SLA overrides; NULL = inherit urgency/global targets.
  sla_response_hours    INTEGER,
  sla_resolution_hours  INTEGER
);
-- Upgrades: pre-v2 departments lack the routing columns.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS hours JSONB;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS after_hours TEXT NOT NULL DEFAULT 'urgency_based';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS fallback_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS on_call_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sla_response_hours INTEGER;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sla_resolution_hours INTEGER;

CREATE TABLE IF NOT EXISTS user_departments (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  emoji         TEXT NOT NULL DEFAULT '📝',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  sort          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locations (
  id        SERIAL PRIMARY KEY,
  slug      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  area      TEXT NOT NULL DEFAULT 'General',
  active    BOOLEAN NOT NULL DEFAULT true,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id              SERIAL PRIMARY KEY,
  public_code     TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'issue',          -- issue | request | feedback | compliment
  status          TEXT NOT NULL DEFAULT 'new',            -- new | in_progress | resolved | closed
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  location_id     INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  location_text   TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL,
  urgency         TEXT NOT NULL DEFAULT 'normal',         -- low | normal | high | safety
  guest_name      TEXT NOT NULL DEFAULT '',
  guest_email     TEXT NOT NULL DEFAULT '',
  guest_phone     TEXT NOT NULL DEFAULT '',
  updates_email   TEXT NOT NULL DEFAULT '',              -- guest opted into email updates (thank-you / tracking page)
  group_name      TEXT NOT NULL DEFAULT '',
  photo_path      TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'qr',             -- qr | web | kiosk
  ai_processed    BOOLEAN NOT NULL DEFAULT false,
  ai_summary      TEXT NOT NULL DEFAULT '',
  rating          INTEGER,                                -- 1..5 CSAT, set by guest
  rating_comment  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  -- v2: assignment, triage provenance, hours-aware SLA clock, scheduler flags.
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  triage_via      TEXT NOT NULL DEFAULT '',                -- ai | keywords | '' (pre-upgrade)
  sla_start_at    TIMESTAMPTZ,                             -- when the SLA clock starts (deferred while held)
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at     TIMESTAMPTZ,
  held_until      TIMESTAMPTZ,                             -- non-null = waiting for the department to open
  rerouted_from_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  response_warned_at    TIMESTAMPTZ,                       -- scheduler idempotency flags
  response_breached_at  TIMESTAMPTZ,
  resolution_warned_at  TIMESTAMPTZ,
  resolution_breached_at TIMESTAMPTZ
);
-- Upgrades: pre-v2 submissions lack the v2 columns.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS triage_via TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS sla_start_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS held_until TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS rerouted_from_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS response_warned_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS response_breached_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resolution_warned_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS resolution_breached_at TIMESTAMPTZ;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS updates_email TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON submissions (status);
CREATE INDEX IF NOT EXISTS idx_submissions_cat     ON submissions (category_id);
CREATE INDEX IF NOT EXISTS idx_submissions_loc     ON submissions (location_id);
CREATE INDEX IF NOT EXISTS idx_submissions_dept    ON submissions (department_id);
CREATE INDEX IF NOT EXISTS idx_submissions_resp_due ON submissions (first_response_due_at) WHERE first_response_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_reso_due ON submissions (resolution_due_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_held     ON submissions (held_until) WHERE held_until IS NOT NULL;

-- ===== v2 upgrade: submission_events.admin_id → user_id (before CREATE) =====
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'submission_events'
               AND column_name = 'admin_id') THEN
    ALTER TABLE submission_events RENAME COLUMN admin_id TO user_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS submission_events (
  id            SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,             -- created | status | assign | note | ai | rating | forward | route | sla | notify
  detail        TEXT NOT NULL DEFAULT '',
  is_public     BOOLEAN NOT NULL DEFAULT false,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_submission ON submission_events (submission_id, created_at);

-- Guest-surface traffic: one row per guest-form open (client fires a beacon,
-- gated to once per device per half hour). visitor_key is sha256(ip|ua|date)
-- truncated — a per-day device fingerprint for unique counts; no raw IP or
-- user agent is ever stored.
CREATE TABLE IF NOT EXISTS visits (
  id           SERIAL PRIMARY KEY,
  location_id  INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  loc_slug     TEXT NOT NULL DEFAULT '',    -- slug as scanned, kept even if the location goes away
  source       TEXT NOT NULL DEFAULT 'web', -- qr | kiosk | web
  visitor_key  TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_created ON visits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_loc     ON visits (location_id, created_at);

-- RAP capture ledger + delivery queue (rap.js). RAP's board is the system of
-- record for tickets; this table is what WoodsVoice keeps at capture time: the
-- exact payload awaiting delivery to RAP's intake API (drained by a background
-- sender with retry/backoff, so notes survive crashes and RAP downtime), plus
-- the guest-facing extras RAP doesn't own for us — our MW tracking code, the
-- email-updates opt-in, the CSAT rating, and the local photo path. After
-- delivery the row is the permanent link record: rap_ticket_id (from RAP's
-- 201) joins it to the mirrored ticket in rap_tickets.
-- submission_id is a legacy column from when tickets were stored locally;
-- NULL on all new rows.
CREATE TABLE IF NOT EXISTS rap_queue (
  id                SERIAL PRIMARY KEY,
  submission_id     INTEGER UNIQUE,
  public_code       TEXT,                             -- our MW-XXXXXX tracking code
  payload           JSONB NOT NULL,
  guest_name        TEXT NOT NULL DEFAULT '',
  location_name     TEXT NOT NULL DEFAULT '',
  photo_path        TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL DEFAULT 'qr',       -- qr | web | kiosk
  updates_email     TEXT NOT NULL DEFAULT '',         -- guest opted into email updates
  rating            INTEGER,                          -- 1..5 CSAT once RAP resolves it
  rating_comment    TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed (failed = RAP 400-rejected)
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status       INTEGER,                          -- last HTTP status; NULL = network error/timeout
  last_error        TEXT NOT NULL DEFAULT '',
  rap_submission_id BIGINT,                           -- RAP's ids from the 201, for cross-referencing
  rap_ticket_id     BIGINT,
  sent_at           TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrades: pre-cutover queues have the old shape. The FK to submissions must
-- also stop cascading — a queue row is now the origin ledger and outlives any
-- legacy submission cleanup.
ALTER TABLE rap_queue ALTER COLUMN submission_id DROP NOT NULL;
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS public_code TEXT;
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS guest_name TEXT NOT NULL DEFAULT '';
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS location_name TEXT NOT NULL DEFAULT '';
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS photo_path TEXT NOT NULL DEFAULT '';
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'qr';
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS updates_email TEXT NOT NULL DEFAULT '';
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS rating INTEGER;
ALTER TABLE rap_queue ADD COLUMN IF NOT EXISTS rating_comment TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rap_queue_submission_id_fkey') THEN
    ALTER TABLE rap_queue DROP CONSTRAINT rap_queue_submission_id_fkey;
    ALTER TABLE rap_queue ADD CONSTRAINT rap_queue_submission_id_fkey
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE SET NULL;
  END IF;
END $$;
-- One-time backfill from legacy locally-stored submissions, so tracking codes
-- handed out before the cutover keep resolving.
UPDATE rap_queue q
   SET public_code    = s.public_code,
       guest_name     = s.guest_name,
       location_name  = coalesce(l.name, s.location_text, ''),
       photo_path     = s.photo_path,
       source         = s.source,
       updates_email  = s.updates_email,
       rating         = s.rating,
       rating_comment = s.rating_comment,
       created_at     = s.created_at
  FROM submissions s LEFT JOIN locations l ON l.id = s.location_id
 WHERE q.submission_id = s.id AND q.public_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_rap_queue_due ON rap_queue (next_attempt_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS rap_queue_code_key ON rap_queue (public_code) WHERE public_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rap_queue_ticket ON rap_queue (rap_ticket_id) WHERE rap_ticket_id IS NOT NULL;

-- The read half: a verbatim cache of RAP's board, refreshed by rapSync.js from
-- GET /api/export. RAP's statuses, categories and departments land here as RAP
-- spells them — no mapping onto any local taxonomy. Rows are disposable cache
-- (safe to truncate; the next sync rebuilds), EXCEPT the observed_* columns,
-- which are stamped by the poller the first time it SEES a transition — they
-- back response/resolution metrics even when the export carries no timestamps.
CREATE TABLE IF NOT EXISTS rap_tickets (
  id                   BIGINT PRIMARY KEY,             -- RAP's ticket id
  status               TEXT NOT NULL DEFAULT '',       -- RAP's own value: open | in_progress | resolved | …
  department           TEXT NOT NULL DEFAULT '',       -- RAP's own labels, verbatim
  category             TEXT NOT NULL DEFAULT '',
  severity             INTEGER,                        -- 1..5 per RAP's triage
  mood                 INTEGER,                        -- 1 (happy) .. 5 (extremely upset)
  building             TEXT NOT NULL DEFAULT '',
  summary              TEXT NOT NULL DEFAULT '',
  text                 TEXT NOT NULL DEFAULT '',       -- guest text, when the export carries it
  history              JSONB NOT NULL DEFAULT '[]',    -- [{text, at}] as parsed from the export
  guest_notes          JSONB NOT NULL DEFAULT '[]',    -- [{at, text}] one-way messages for the guest, oldest first
  raw                  JSONB,
  rap_created_at       TIMESTAMPTZ,
  rap_updated_at       TIMESTAMPTZ,
  rap_resolved_at      TIMESTAMPTZ,
  observed_response_at TIMESTAMPTZ,                    -- first sync where status ≠ open
  observed_resolved_at TIMESTAMPTZ,                    -- first sync where status = resolved/closed
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rap_tickets ADD COLUMN IF NOT EXISTS guest_notes JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_rap_tickets_status  ON rap_tickets (status);
CREATE INDEX IF NOT EXISTS idx_rap_tickets_created ON rap_tickets (rap_created_at DESC);

-- RAP mirror (rapMirror.js): the latest known state of each forwarded note's
-- ticket on the central RAP board, pulled back by the mirror poller. One row
-- per linked submission; status/routing changes detected against this row are
-- applied to the submission itself, so this table is both cache and change
-- detector. raw keeps RAP's full ticket object for debugging; history_count
-- tracks how many RAP history entries are already mirrored into
-- submission_events (RAP history is append-only).
CREATE TABLE IF NOT EXISTS rap_mirror (
  submission_id  INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  rap_ticket_id  BIGINT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT '',     -- RAP's own value: open | in_progress | resolved | …
  department     TEXT NOT NULL DEFAULT '',     -- RAP's own labels, verbatim
  category       TEXT NOT NULL DEFAULT '',
  severity       INTEGER,                      -- 1..5 per RAP's triage
  mood           INTEGER,                      -- 1 (happy) .. 5 (extremely upset)
  building       TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  history_count  INTEGER NOT NULL DEFAULT 0,
  raw            JSONB,
  rap_updated_at TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
