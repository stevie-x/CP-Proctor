# CP Proctor

A lightweight, browser-only proctoring system for competitive programming contests. No native agent, no OS-level hooks — everything runs inside a Chrome extension using in-browser ML (face-api.js) and standard browser APIs (Fullscreen API, tab/URL events, webcam).

Built for [HackerRank](https://hackerrank.com)-style contest pages, but works on any page since URL enforcement is scoped to whatever page the contest was started from.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension (MV3)                    │
│                                                                 │
│  content.js  ──────────┐                                       │
│  (runs on every page)  │  tab switches, URL changes,            │
│                         │  fullscreen exits, keystrokes,        │
│                         │  paste events                         │
│                         ▼                                       │
│                  background.js (service worker)                │
│                   - logs all events locally                    │
│                   - applies violation rules                    │
│                   - reports violations to Supabase              │
│                   - kicks user after N violations               │
│                         ▲                                       │
│  webcam.html/js ────────┘  face presence, multiple faces,       │
│  (face-api.js, on-device,     gaze/head-turn, lighting check    │
│   no cloud calls)                                                │
│                                                                 │
│  popup.html/js — session join/create, live event log            │
│  login.html/js — Supabase auth (sign up / in / password reset)  │
│  dashboard.html/js — organizer view of violations for a session │
└──────────────────────────┬──────────────────────────────────────┘
                            │ REST (PostgREST) + Auth
                            ▼
                    Supabase (Postgres + Auth)
                    sessions / session_members / violations
```

**Why no C++ agent / OS-level component:** an earlier design used a local C++ agent (OpenCV, OS-level app enforcement) but was scoped back to a browser-only design — see "Design decisions" below. Everything now runs inside the extension: fullscreen lockdown replaces OS-level window enforcement, and face-api.js (a WASM/JS port of a lightweight CNN) replaces the native OpenCV pipeline.

## Features

- **Fullscreen lockdown** — contest starts in fullscreen; exiting it is logged and blocks progress until re-entry.
- **URL enforcement** — navigating away from the contest page's origin during an active contest is flagged.
- **Face presence detection** — flags sustained absence from camera (TinyFaceDetector, on-device).
- **Multiple face detection** — flags when more than one person is in frame.
- **Gaze / head-turn detection** — flags sustained head turns toward a second screen or phone, using 68-point facial landmarks (a head-pose proxy, not true iris tracking — see comments in `webcam.js` for the exact heuristic and its limits).
- **Pre-contest lighting calibration** — checks lighting is good enough *before* the contest starts, and suppresses face-detection violations if lighting degrades mid-contest instead of penalizing the user for something outside their control.
- **Session system** — an organizer creates a session and gets a shareable code; participants join with that code; all violations are scoped to that session.
- **Organizer dashboard** — live violation feed per session, with auto-refresh and summary stats (participant count, total violations, high-risk users, average flag-delivery latency).
- **Codeforces risk scoring** — cross-references behavioral events against a user's accepted submission timestamps to flag suspicious windows.

## Install

1. Clone or download this repo.
2. Go to `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked**, select the `extension/` folder.
4. Set up your own Supabase project (see below) — the included keys are for development only.

### Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Create three tables (see `supabase_rls.sql` header comment for exact column expectations):
   - `sessions(code text primary key, admin_email text, created_at timestamptz default now())`
   - `session_members(id uuid primary key default gen_random_uuid(), session_code text references sessions(code), user_email text, joined_at timestamptz default now())`
   - `violations(id uuid primary key default gen_random_uuid(), session_code text references sessions(code), user_email text, violation_type text, details jsonb, created_at timestamptz default now())`
3. Run `supabase_rls.sql` in the SQL Editor to lock down row-level security — **do this before sharing the extension with anyone**, otherwise your anon key (which ships inside the extension source) grants full read/write to every row in every table.
4. In **Authentication > URL Configuration**, add `chrome-extension://<your-extension-id>/reset-password.html` to the Redirect URLs allow-list, or the "forgot password" email link won't work. You can find your extension ID on `chrome://extensions` after loading it.
5. Replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `supabase.js`, `login.js`, `popup.js`, `background.js`, `dashboard.js`, and `reset-password.js` with your own project's values.

## Usage

**As a participant:**
1. Click the extension icon, sign in (or sign up).
2. Enter the session code your organizer gave you and click Join.
3. Go to the contest page, click **Start Contest** — this opens the webcam calibration screen and requests fullscreen.
4. Fix your lighting until the meter reads "Good," then click **Begin Monitoring**.

**As an organizer:**
1. Sign in with the "Admin / Organizer" role.
2. Click **Create Session**, share the generated code with participants.
3. Open `dashboard.html` (or navigate to `chrome-extension://<id>/dashboard.html`), enter the session code, and watch violations come in live (auto-refreshes every few seconds).

## Known limitations

- **Gaze detection is a head-pose proxy, not iris tracking.** The tiny 68-point landmark model doesn't resolve pupil position, so it can't distinguish "eyes flicked to the corner" from "still looking at the screen." It reliably catches sustained head turns (looking at a phone/second monitor), which is the more common real-world signal anyway.
- **Lighting calibration is a simple average-luminance check**, not a full exposure/contrast analysis. It catches "too dark to see a face" and "blown out by a window behind you," not more subtle issues.
- **Dashboard auto-refresh is polling, not push.** True real-time (Supabase Realtime / websockets) would cut latency further; polling was chosen to avoid pulling in the full supabase-js client for one feature. See "Performance" below for what this costs in practice.
- **Paste detection is Chrome-only** and won't catch OS-level clipboard use outside the browser — this was a known tradeoff when the project moved away from the native agent.

## Performance

The extension now includes built-in instrumentation rather than fabricated numbers — you'll see real, live measurements when you run it:

- **Detection loop cost:** `webcam.html`'s monitor screen shows a live `detect loop: Xms (avg Yms over N frames)` readout — this is the actual per-frame cost of face detection + landmark extraction + lighting sampling on your machine. This is the best available proxy for CPU cost without a dedicated profiler; pair it with Chrome's Task Manager (`Shift+Esc`) filtered to the extension's processes for an actual CPU% reading.
- **Flag delivery latency:** the dashboard's "Avg. flag delivery latency" card measures real wall-clock time between a violation's `created_at` in the database and the moment your dashboard's poll first observed it — a genuine (if polling-bounded) measurement of violation → dashboard visibility time, averaged over the last 50 violations seen in the current dashboard session.

Numbers will vary by machine, lighting, and poll interval — run it yourself and record what you see rather than trusting any number written here in advance.

## Multi-user testing

See `TESTING.md` for a manual multi-browser-profile testing checklist, and `scripts/simulate_participants.js` for a script that hits the Supabase REST API directly to simulate several participants joining a session and reporting violations concurrently (useful for checking the dashboard aggregates correctly and RLS policies don't fall over under concurrent writes — it does not exercise the actual face detection or extension UI, only the backend).

## Roadmap / design decisions

- **Week 1–4:** browser extension scaffold, Codeforces API integration, risk scoring, Supabase auth + sessions.
- **Week 4 pivot:** scope revised to drop the planned C++ local agent and OS-level enforcement entirely, in favor of fullscreen lockdown — this keeps the whole system lightweight (single browser extension, no native install) at the cost of not catching OS-level clipboard/app-switching outside the browser.
- **Week 5–6:** fullscreen lockdown, organizer dashboard, in-browser webcam face detection via face-api.js (replacing the originally-planned native OpenCV pipeline).
- **This round:** gaze detection, lighting calibration, URL-violation false-positive fix, RLS, password reset, dashboard auto-refresh, session-flow cleanup.

## License

Add your license of choice here.