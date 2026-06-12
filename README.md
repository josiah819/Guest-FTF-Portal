# 🌲 WoodsVoice

**Scan. Tell us. We're on it.** — Guest feedback & request system for Muskoka Woods Schools & Retreats.

Guests scan a QR code in their cabin or a common area and land on a 30-second form that already knows where they are. An AI layer (Claude) categorizes each submission, grades urgency, writes a one-line staff summary and routes it to the right department. The Guest Care team works from a dashboard with response-time metrics, trends, hotspot detection and AI insights.

Built to match the vision in Cindy's email:

| Ask | Where it lives |
| --- | --- |
| QR codes in cabins & common areas | **Admin → Locations & QR** — print-ready QR cards per location, form pre-fills the location |
| AI categorizes submissions | Claude triages every submission (category, urgency, one-line summary); keyword fallback without an API key |
| Route to departments / FTF | Category → department routing, plus an **FTF webhook** that POSTs each submission as JSON to your intake endpoint |
| Visibility into issues, trends, response times | Dashboard: volume, categories, locations, CSAT, avg first-response & resolution, SLA watch, hotspots, AI insights |
| "Start small, test the wording" | Every guest-facing string, every field requirement and every feature is editable/toggleable in **Admin → Settings** |
| Don't create hotel-concierge expectations | Configurable **expectation banner** on the form (on by default) |

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
| http://woodsvoice.10.0.12.189.nip.io/admin | Guest Care HQ (dashboard, inbox, settings) |

**Default admin login:** `admin` / `WoodsVoice!demo` — change it in Settings → Account (or via `.env` before first boot).

A realistic demo dataset loads on first boot so the dashboard isn't empty (`SEED_DEMO_DATA=false` to disable). To start truly fresh: `docker compose down -v && docker compose up -d --build`.

## The AI layer

Set `ANTHROPIC_API_KEY` in `.env` and restart (`docker compose up -d`). That enables:

- **Triage** — every new submission is categorized, urgency-graded (`low / normal / high / safety`) and summarized in one line for the inbox. Guests can skip the category entirely; Claude sorts it. Guest choices are never overridden.
- **Dashboard insights** — one click turns the last 30 days into 3–5 concrete, actionable observations.

Without a key, categorization falls back to keyword matching and everything else still works. Model defaults to `claude-opus-4-8` (`AI_MODEL` to change). Triage runs async after the guest's submit — the form is never slowed down by the API.

## Admin controls (Settings)

- **Form fields** — every field (location, urgency, photo, name, email, phone, group) is `Off / Optional / Required`. Message is always required.
- **Features** — 14 toggleable features: AI categorization, AI insights, submission types, photo upload, urgency, tracking codes, CSAT ratings, kiosk mode, hotspot detection, SLA targets, CSV export, QR generator, FTF webhook, email notifications.
- **Categories & Departments** — fully editable; each category routes to a department.
- **General** — every guest-facing string (titles, success copy, expectation banner).
- **Locations & QR** — manage locations, print the QR sheet.

## Architecture

```
woodsvoice/
├── docker-compose.yml      # db (Postgres 16) + backend (Node 20/Express) + frontend (nginx)
├── backend/                # REST API, JWT auth, AI triage, metrics, seeds
│   └── src/
│       ├── index.js        # app entry, boot retry, error handling
│       ├── db.js           # pool, schema apply, default settings, demo seed
│       ├── classify.js     # Claude triage + keyword fallback, AI insights
│       ├── metrics.js      # dashboard aggregations
│       ├── forward.js      # FTF webhook + email notification log
│       └── routes/         # public.js (guest), admin.js (authed)
└── frontend/               # React 18 + Vite, served by nginx (proxies /api)
    └── src/
        ├── guest/          # GuestForm (QR landing), Track (status + rating)
        └── admin/          # Dashboard, Submissions, Locations & QR, Settings
```

- **Single origin:** nginx serves the SPA and proxies `/api` + `/uploads` to the backend — no CORS, works on any host/port.
- **Data:** Postgres volumes `pgdata` (database) and `uploads` (guest photos) persist across rebuilds.
- **Brand:** official Muskoka Woods palette (#1E5A64 / #A3CD42), League Gothic + Montserrat + Nunito Sans per [muskokabranding.com](https://muskokabranding.com/), self-hosted fonts and logos (works offline at camp).
- **Safety-first inbox:** open safety-urgency items pin to the top of the inbox and trigger a dashboard alert.

## Notes for production

- Set real values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_PASSWORD` and put the app behind HTTPS (any reverse proxy).
- Guest photo URLs are unguessable random filenames but served without auth — fine for an internal tool, add an auth proxy if photos may be sensitive.
- `emailForward` logs intended notifications in the submission timeline; point it at your SMTP relay when you're ready.
- Runs side-by-side with woods360: separate compose projects on the same shared `web` proxy network — `woodsvoice.10.0.12.189.nip.io` vs `woods360.10.0.12.189.nip.io`, no host ports to collide.
