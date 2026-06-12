-- WoodsVoice schema. Idempotent: runs on every boot.

CREATE TABLE IF NOT EXISTS app_settings (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL DEFAULT 'Guest Care Admin',
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  sort       INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS submission_events (
  id            SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,             -- created | status | assign | note | ai | rating | forward
  detail        TEXT NOT NULL DEFAULT '',
  is_public     BOOLEAN NOT NULL DEFAULT false,
  admin_id      INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_submission ON submission_events (submission_id, created_at);
