# 🌲 WoodsVoice

**Scan. Tell us. We're on it.** — Guest feedback & request system for Muskoka Woods Schools & Retreats.

Guests scan a QR code in their cabin or a common area and just **type what they need** — one text box, optional name, optional photo. The note is delivered straight to **RAP (rap.mwprogram.com), Muskoka Woods’ central Report-A-Problem board**, which is the system of record: its AI triages every ticket (category, department, severity, guest mood, summary) and its staff work them. WoodsVoice is the guest-facing layer around that board — capture and delivery, the MW-code tracking page, guest status emails, and a read-only inbox + dashboard that sync the whole board back once a minute.

## What's in v3

- **RAP is the database.** Tickets live on the central RAP board. Capture writes one durable queue row (payload + our MW code + guest extras) and a background sender delivers it; a sync poller pulls **every** board ticket — including ones submitted from other sources — into a local verbatim cache that the inbox, dashboard, tracking page and emails all read. No local triage, no taxonomy translation: RAP’s statuses, categories and departments appear exactly as RAP spells them.
- **Zero-friction guest form** — message + optional name + optional photo. Guest picks (type, urgency, category), when enabled, travel to RAP as triage hints.
- **Full RBAC** — custom roles with a per-permission checkbox matrix, per-user department membership (matched against RAP’s department labels for scoped inbox views), invite-based onboarding, Google sign-in.
- **Everything editable** — every guest-facing word, label, page section, logo and brand colour lives in **Settings → Content**.
- **Guest email updates** — after sending a note, guests can leave an email address (thank-you screen or tracking page) and get branded emails as the board moves it along: sign-up confirmation, in progress, resolved. Templates editable with live preview in **Settings → Content → Guest update emails**; the option only appears to guests once SMTP is configured. Test locally with `docker-compose.mailpit.yml` (catches all mail at http://localhost:8025).
- **Guest notes** — one-way messages RAP staff write for the guest sync back and appear on the tracking page.

Built to match the vision in Cindy's email:

| Ask | Where it lives |
| --- | --- |
| QR codes in cabins & common areas | **Admin → Locations & QR** — print-ready QR cards per location (with fallback URL printed under each code), form pre-fills the location |
| AI categorizes submissions | RAP’s board AI triages every ticket (category, department, severity, mood, summary); the verdict syncs back within a minute |
| Route to departments / FTF | The **RAP hand-off** — every note is queued at capture and delivered to the central Report-A-Problem intake API (bearer key, automatic retry); routing happens on the board |
| Visibility into issues, trends, response times | Dashboard over the synced board: volume, categories, departments, severity, guest mood, locations, CSAT, response/resolution times, hotspots, AI insights |
| "Is anyone actually scanning the QR codes?" | **Visit tracking** — every guest-form open is counted (by location + QR/kiosk/web source, no cookies or personal data); the dashboard shows visits over time, arrival sources, and per-location scans vs. notes sent, flagging cards with zero scans |
| "Start small, test the wording" | Every guest-facing string, every field requirement and every feature is editable/toggleable in **Admin → Settings** |
| Don't create hotel-concierge expectations | Configurable **expectation banner** on the form (on by default) |

…and Cindy's follow-up review cards:

| Ask | Where it lives |
| --- | --- |
| "Demo the app for Cindy" — how does it work? triage? workflow? notifications? analytics/SLA? | **`/how`** — a shareable, no-login page: the 5-step journey, how staff get notified, what's measured, plus a **5-minute live demo script** with a scannable QR |
| "What is the measurement for success? Who monitors the SLA?" | Dashboard shows first-action and resolution times measured from the board sync, per-department volume/open/median-resolution, and CSAT — all computed from RAP’s own ticket state |
| "Reduce friction — shorten the form" | Message-first layout; optional contact fields collapse behind one tap; **returning guests are remembered** on their own device (never on kiosks); QR still pre-fills the location |
| "Start with a test — what areas, which departments, how soon?" | The **pilot plan** on `/how`: Week 0 staff dry-run → Weeks 1–2 small pilot (3–5 cabins + dining hall) → Week 3 review & widen, with the five numbers to judge it by |

## Quick start

Requires Docker Desktop (or any Docker engine with Compose v2+).

```bash
git clone https://github.com/josiah819/Guest-FTF-Portal.git
cd Guest-FTF-Portal
cp .env.example .env                 # then edit secrets (optional for a first look)
docker network create web            # once per host, if it doesn't exist yet
docker compose up -d --build
```

The app publishes **no host ports** — it joins the shared external `web` network and the
Caddy reverse proxy serves it at `woodsvoice.10.0.12.189.nip.io` (labels on the
`frontend` service, container port 80). Then open:

| URL | What |
| --- | --- |
| http://woodsvoice.10.0.12.189.nip.io/ | Guest form (what the QR codes open) |
| http://woodsvoice.10.0.12.189.nip.io/?loc=cabin-3 | Guest form with location pre-filled — what a cabin QR encodes |
| http://woodsvoice.10.0.12.189.nip.io/?kiosk=1 | Kiosk mode for a lobby tablet (big buttons, auto-reset) |
| http://woodsvoice.10.0.12.189.nip.io/t/MW-XXXXXX | Guest tracking page |
| http://woodsvoice.10.0.12.189.nip.io/admin | Guest Care HQ (dashboard, inbox, QR codes, settings) |

On phones, Guest Care HQ uses a bottom tab bar and can be added to the home screen (PWA manifest, `start_url: /admin`).

**Default admin login:** `admin` / `WoodsVoice!demo` — change it in Settings → Account (or via `.env` before first boot).

Demo teammates seed on first boot (`SEED_DEMO_DATA=false` to disable); the inbox and dashboard fill from the RAP board on the first sync. To start truly fresh: `docker compose down -v && docker compose up -d --build`.

## Production — woodsvoice.com (Cloudflare Tunnel)

The live site is served through the named Cloudflare tunnel **woodsvoice** (account
Josiah819@gmail.com): DNS for `woodsvoice.com` / `www` points at the tunnel, and a
`cloudflared` container (added by `docker-compose.prod.yml`) connects out to
Cloudflare and forwards to `http://frontend:80`. No host ports, no Caddy, no
port-forwarding.

```bash
git clone https://github.com/josiah819/Guest-FTF-Portal.git && cd Guest-FTF-Portal
cp .env.example .env
# .env must set, at minimum:
#   POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD  — strong random values
#   SEED_DEMO_DATA=false                           — no demo content in prod
#   PUBLIC_BASE_URL=https://woodsvoice.com
#   GOOGLE_CLIENT_ID=…                             — see .env.example for the prod client id
#   TUNNEL_TOKEN=…                                 — from the Cloudflare dashboard (see .env.example)
#   RAP_INGEST_KEY=…                               — notes queue locally until set
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

**Run exactly one connector.** If the stack moves to another machine, stop the old
one (`docker compose down`) before starting the new one — two connectors on one
tunnel round-robin visitors across two databases. After first boot, set the admin
user's email (Team page) to the Google address that should own the account; the
first Google sign-in with a matching email links permanently. Google's OAuth
config lives in the **WoodsVoice** project in Google Cloud Console (consent screen
published, origins `https://woodsvoice.com` + `https://www.woodsvoice.com`).

## The AI layer

Ticket triage happens on the RAP board, not here. The provider in **Settings → AI**
powers only the dashboard’s **AI insights** card:

- **Anthropic API** — set `ANTHROPIC_API_KEY` in `.env`; model editable (default `claude-haiku-4-5-20251001`).
- **Local / self-hosted** — point the base URL at any OpenAI-compatible endpoint (e.g. Ollama: `http://10.0.12.x:11434`, model like `qwen3:4b`). Nothing leaves the network; `OPENAI_API_KEY` only if your endpoint needs auth.
- **None** — insights stay off.

## RAP hand-off (central intake)

WoodsVoice is the guest-facing **intake half** of RAP (“Report A Problem”), Muskoka
Woods’ central ticketing system and the **system of record for tickets**. Every new
guest note is captured as one durable queue row and delivered to the RAP intake API,
where RAP’s own AI extracts cabin/department/severity and staff work the ticket. The
queue row is the permanent capture ledger: it keeps the MW tracking code, the photo
file, the email-updates opt-in and the CSAT rating, and the `ticket_id` RAP returns
at delivery links it to the synced board copy.

- **Configure:** put the bearer key the RAP operator gives you in `.env` as
  `RAP_INGEST_KEY` (env only — never in the database, logs, or any browser; all
  posting happens from the backend). The feature toggle lives in **Settings →
  Features → RAP hand-off** (on by default) with a live delivery/queue readout.
- **Reliable by design:** notes land in the `rap_queue` table at capture time and a
  background sender delivers them (batches ≤5 per 15 s, under RAP’s 30 req/min limit).
  Failures follow the intake contract: 429 pauses the sender ≥60 s; 503 and network
  errors retry with exponential backoff (30 s → 15 min) carrying the **original**
  `submitted_at`, and duplicates can’t happen (RAP’s insert is transactional — retries
  only fire when nothing was stored); 400 parks the item as `failed`; 401 or any other
  4xx **halts** the sender until the key/URL is fixed and the backend restarts — queued
  notes are never lost, including across crashes and reboots.
- **Payload:** `{ text, submitted_at }` per contract v2, plus extra fields RAP preserves
  in its raw record. The guest’s text goes verbatim, capped at RAP’s 4 000-char limit
  (the form’s textarea has the same cap). Without a key, notes queue until one is set.
  Everything else the guest gave us goes too, so RAP’s board never needs anyone to come
  back here — identity (`guest_name`, `guest_email`, `guest_phone`, `group_name`), place
  (`location`, `location_slug`, `channel`), the guest’s **own** picks when they made one
  (`guest_type`, `guest_urgency`, `guest_category` — never our internal defaults, which
  would read to RAP’s triage as a real answer), and links (`photo_url`, `tracking_url`,
  built from `PUBLIC_BASE_URL`). Blank answers are omitted rather than sent as `""`.
  Guest contact details therefore leave this system — that’s deliberate, and the RAP
  board is the only place they go.
- **Smoke test** (prefix with `INTAKE-TEST:` so the RAP operator can spot and delete it):

```bash
curl -sS -X POST https://rap.mwprogram.com/api/ingest \
  -H "Authorization: Bearer $RAP_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "INTAKE-TEST: hello from WoodsVoice", "submitted_at": "2026-08-04T12:00:00Z"}'
```

## RAP board sync (the read half)

The hand-off is one half of the loop; the **sync** is the other — and it is the only
source of ticket data WoodsVoice has. Once a minute (ETag-cheap; instantly after a
delivery) the backend polls RAP's export API (`GET /api/export`, bearer key) and
caches **every ticket on the board verbatim** in `rap_tickets`:

- **No translation** — RAP's statuses (`open / in_progress / resolved / …`),
  categories, departments, severity 1–5 and guest mood appear in the inbox and
  dashboard exactly as RAP spells them; filter facets are learned from the data.
- **Everything on the board** — tickets that arrived at RAP from other sources show
  too, marked “from another source”; tickets submitted here carry their MW code,
  guest details, photo and source channel from the capture ledger.
- **Guest experience follows the board** — the `/t/MW-XXXXXX` tracking page, the
  opt-in status emails (in progress / resolved) and the CSAT invite are all driven by
  status changes the sync observes; **guest notes** RAP staff write for the guest
  appear on the tracking page.
- **History** — RAP's ticket history (routing decisions, staff notes) shows in the
  inbox drawer as 🔁 entries.
- **Read-only inbox** — ticket work (status, routing, notes) happens on the RAP
  board, one click away from every row; changes sync back within a minute.

The sync reuses `RAP_INGEST_KEY`; if the RAP operator issues a separate read key, set
`RAP_EXPORT_KEY`. If the key isn't authorized for the export API the sync halts and
says so in **Settings → Features**, where a **Test sync** button probes the endpoint
and reports exactly what came back (including whether the export carries the guest
text). If RAP is briefly unreachable the site keeps serving the last synced state.

## Admin controls (Settings)

- **Form fields** — every field (location, category picker, urgency, photo, name, email, phone, group) is `Off / Optional / Required`. Message is always required; the v2 default form is just message + name + photo.
- **Features** — RAP delivery, RAP board sync (with live queue/sync readouts and the Test sync probe), AI insights, submission types, photo upload, guest urgency flag, tracking codes, CSAT ratings, guest email updates, kiosk mode, hotspot detection, CSV export, QR generator, visit tracking.
- **AI** — insights provider picker + models.
- **Content** — all guest-facing wording: form microcopy, tracking page, type/urgency/status labels, the whole `/how` page (journey, measures, demo script, pilot plan as editable lists), logos and brand colours.
- **Categories & Departments** — the guest form’s category picker (sent to RAP as a hint) and the local department names used for department-scoped staff access, matched against RAP’s labels.
- **Team** (own page) — users, roles and the permission matrix.
- **Locations & QR** — manage locations, print the QR sheet.

## Architecture

```
woodsvoice/
├── docker-compose.yml      # db (Postgres 16) + backend (Node 20/Express) + frontend (nginx)
├── backend/                # REST API, JWT auth, metrics, seeds
│   └── src/
│       ├── index.js        # app entry, boot retry, error handling
│       ├── db.js           # pool, schema apply, default settings, seeds
│       ├── rap.js          # RAP hand-off: capture ledger + retrying sender
│       ├── rapSync.js      # RAP board sync: verbatim ticket cache + guest emails
│       ├── classify.js     # AI insights
│       ├── metrics.js      # dashboard aggregations over the board cache
│       └── routes/         # public.js (guest), admin.js (authed)
└── frontend/               # React 18 + Vite, served by nginx (proxies /api)
    └── src/
        ├── guest/          # GuestForm (QR landing), Track (status + rating)
        └── admin/          # Dashboard, Submissions, Locations & QR, Settings
```

- **Single origin:** nginx serves the SPA and proxies `/api` + `/uploads` to the backend — no CORS, works on any host/port.
- **Data:** Postgres volumes `pgdata` (database) and `uploads` (guest photos) persist across rebuilds.
- **Brand:** official Muskoka Woods palette (#1E5A64 / #A3CD42), League Gothic + Montserrat + Nunito Sans per [muskokabranding.com](https://muskokabranding.com/), self-hosted fonts and logos (works offline at camp).
- **Safety-first inbox:** open severity-5 tickets pin to the top of the inbox and trigger a dashboard alert.

## Notes for production

- Set real values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD` and put the app behind HTTPS (any reverse proxy).
- Set `RAP_INGEST_KEY` (from the RAP operator) so guest notes reach the central Report-A-Problem system — see **RAP hand-off** above. Until then they queue locally and the Settings page says so.
- Guest photo URLs are unguessable random filenames but served without auth — fine for an internal tool, add an auth proxy if photos may be sensitive.
- Email needs `SMTP_HOST` (+ optional auth) in `.env`; until then every notification is logged on the submission timeline instead of sent.
- Upgrading an existing install is automatic: schema migrations are guarded and run on boot (the old `admins` table becomes `users` with the Administrator role), and a one-time settings migration simplifies the guest form (re-enable anything under Settings → Form fields).
- Runs side-by-side with woods360: separate compose projects on the same shared `web` proxy network — `woodsvoice.10.0.12.189.nip.io` vs `woods360.10.0.12.189.nip.io`, no host ports to collide.
