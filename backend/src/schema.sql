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

CREATE TABLE IF NOT EXISTS app_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  sort       INTEGER NOT NULL DEFAULT 0
);

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
  group_name      TEXT NOT NULL DEFAULT '',
  photo_path      TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'qr',             -- qr | web | kiosk
  ai_processed    BOOLEAN NOT NULL DEFAULT false,
  ai_summary      TEXT NOT NULL DEFAULT '',
  rating          INTEGER,                                -- 1..5 CSAT, set by guest
  rating_comment  TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status  ON submissions (status);
CREATE INDEX IF NOT EXISTS idx_submissions_cat     ON submissions (category_id);
CREATE INDEX IF NOT EXISTS idx_submissions_loc     ON submissions (location_id);
CREATE INDEX IF NOT EXISTS idx_submissions_dept    ON submissions (department_id);

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
