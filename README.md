# 🌲 WoodsVoice

**Scan. Tell us. We're on it.** — Guest feedback & request system for Muskoka Woods Schools & Retreats.

Guests scan a QR code in their cabin or a common area and just **type what they need** — one text box, optional name, optional photo. The AI layer works out what kind of note it is, categorizes it, grades urgency, writes a one-line staff summary and routes it to the right department — respecting each department's **opening hours** (urgent items reroute to whoever's on; the rest wait politely with their SLA clock paused). The Guest Care team works from a dashboard with per-department scorecards, SLA compliance, trends, hotspot detection and AI insights.

## What's in v2

- **Zero-friction guest form** — message + optional name + optional photo. The AI infers type, category, department and urgency. Every old picker still exists behind a settings toggle.
- **Pluggable AI triage** — Anthropic API (Claude) **or** any OpenAI-compatible local endpoint (Ollama on an LXC, LM Studio, vLLM), switchable in **Settings → AI** with a test-connection button. Keyword matching remains the always-on fallback.
- **Full RBAC** — custom roles with a per-permission checkbox matrix (14 permissions), per-user department membership, one-time temp passwords, immediate deactivation. Starter roles: Administrator, Department Lead, Staff, Viewer.
- **Department hours & after-hours routing** — weekly hours per department, urgency-based rerouting to fallback departments, on-call escalation when every route is closed, held items released with a digest email at opening.
- **Honest, robust SLA** — targets per department **and** per urgency; clocks start when the owning department opens; scheduler warns at 80% of the window and pages on breaches; median/p90 response times, compliance trends, and per-department scorecards.
- **Everything editable** — every guest-facing word, label, page section, logo and brand colour lives in **Settings → Content**.
- **Real email** — SMTP-backed notifications (new urgent items, SLA warnings/breaches, held-queue digests); without SMTP configured everything logs to the submission timeline instead.

Built to match the vision in Cindy's email:

| Ask | Where it lives |
| --- | --- |
| QR codes in cabins & common areas | **Admin → Locations & QR** — print-ready QR cards per location (with fallback URL printed under each code), form pre-fills the location |
| AI categorizes submissions | Claude triages every submission (category, urgency, one-line summary); keyword fallback without an API key |
| Route to departments / FTF | Category → department routing, plus an **FTF webhook** that POSTs each submission as JSON to your intake endpoint |
| Visibility into issues, trends, response times | Dashboard: volume, categories, locations, CSAT, avg first-response & resolution, SLA watch, hotspots, AI insights |
| "Start small, test the wording" | Every guest-facing string, every field requirement and every feature is editable/toggleable in **Admin → Settings** |
| Don't create hotel-concierge expectations | Configurable **expectation banner** on the form (on by default) |

…and Cindy's follow-up review cards:

| Ask | Where it lives |
| --- | --- |
| "Demo the app for Cindy" — how does it work? triage? workflow? notifications? analytics/SLA? | **`/how`** — a shareable, no-login page: the 5-step journey, how staff get notified, what's measured, plus a **5-minute live demo script** with a scannable QR |
| "What is the measurement for success? Who monitors the SLA?" | Dashboard now shows **SLA compliance %** (first response & resolution within target) on an always-visible card that names the **SLA monitor** and their review cadence (Settings → General → Accountability) |
| "Reduce friction — shorten the form" | Message-first layout; optional contact fields collapse behind one tap; **returning guests are remembered** on their own device (never on kiosks); QR still pre-fills the location |
| "Who's accountable? Maintenance? What could break? Security? SOPs?" | **Admin → Runbook** — printable page with named owners, an honest what-could-break table, security features, and **8 written SOPs** (daily triage, safety, weekly review, QR posting, update/rollback, backup/restore, password reset, season start/end) |
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
| http://woodsvoice.10.0.12.189.nip.io/how | **How it works** — demo walkthrough, notifications, metrics, pilot plan (no login; send this to Cindy) |
| http://woodsvoice.10.0.12.189.nip.io/admin | Guest Care HQ (dashboard, inbox, runbook, settings) |
| http://woodsvoice.10.0.12.189.nip.io/admin/runbook | **Runbook & SOPs** — owners, risks, security, printable procedures |

On phones, Guest Care HQ uses a bottom tab bar and can be added to the home screen (PWA manifest, `start_url: /admin`).

**Default admin login:** `admin` / `WoodsVoice!demo` — change it in Settings → Account (or via `.env` before first boot).

A realistic demo dataset loads on first boot so the dashboard isn't empty (`SEED_DEMO_DATA=false` to disable). To start truly fresh: `docker compose down -v && docker compose up -d --build`.

## The AI layer

Pick the engine in **Settings → AI** (test button included):

- **Anthropic API** — set `ANTHROPIC_API_KEY` in `.env`; model editable (default `claude-haiku-4-5-20251001` — triage is an easy job, roughly a tenth of a cent per submission).
- **Local / self-hosted** — point the base URL at any OpenAI-compatible endpoint (e.g. Ollama: `http://10.0.12.x:11434`, model like `qwen3:4b`). Nothing leaves the network; `OPENAI_API_KEY` only if your endpoint needs auth.
- **Keywords only** — no AI; also the automatic fallback whenever an AI call fails or times out.

Triage decides **type** (issue/request/feedback/compliment), **category → department**, **urgency** (`low / normal / high / safety`) and a one-line staff summary. Guest choices (if the pickers are re-enabled) are never overridden. Everything runs async after the guest's submit — the form is never slowed by a model. Dashboard insights use the same provider.

## Admin controls (Settings)

- **Form fields** — every field (location, category picker, urgency, photo, name, email, phone, group) is `Off / Optional / Required`. Message is always required; the v2 default form is just message + name + photo.
- **Features** — AI triage, AI insights, submission types, photo upload, urgency handling, tracking codes, CSAT ratings, kiosk mode, hotspot detection, SLA targets (global + per-urgency + warn-%), CSV export, QR generator, FTF webhook, email notifications.
- **AI** — provider picker + models + test connection.
- **Content** — all guest-facing wording: form microcopy, tracking page, type/urgency/status labels, the whole `/how` page (journey, measures, demo script, pilot plan as editable lists), logos and brand colours.
- **Categories & Departments** — fully editable; each category routes to a department. Departments carry **hours, after-hours policy, fallback chain, on-call person and SLA overrides** (🕐 Hours on each row).
- **Team** (own page) — users, roles and the permission matrix.
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
- Email needs `SMTP_HOST` (+ optional auth) in `.env`; until then every notification is logged on the submission timeline instead of sent.
- Upgrading an existing install is automatic: schema migrations are guarded and run on boot (the old `admins` table becomes `users` with the Administrator role), and a one-time settings migration simplifies the guest form (re-enable anything under Settings → Form fields).
- Runs side-by-side with woods360: separate compose projects on the same shared `web` proxy network — `woodsvoice.10.0.12.189.nip.io` vs `woods360.10.0.12.189.nip.io`, no host ports to collide.
