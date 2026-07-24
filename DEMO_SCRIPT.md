# Demo video — shotlist (2–3 min)

I can't record screen/webcam video from here, so this is a shot-by-shot script you can follow to record it yourself in one take (screen recorder + your own webcam feed). Rough timing adds up to ~2:30.

| Time | Shot | What to say / show |
|---|---|---|
| 0:00–0:15 | Title card or talking head | "CP Proctor — a lightweight, browser-only proctoring extension for competitive programming contests. No native agent, everything runs in Chrome." |
| 0:15–0:35 | `chrome://extensions`, click into the extension popup | Sign in as organizer. "Organizers sign in, create a session, and get a shareable code." Click Create Session, show the code appear. |
| 0:35–0:55 | Second browser profile (or switch accounts) | Sign in as participant, paste the session code, Join. "Participants join with that code — nothing is monitored until they do, which was one of the things we fixed this round." |
| 0:55–1:15 | Contest page, click Start Contest | Show fullscreen entry + webcam calibration screen appearing. "Before anything is monitored, we check lighting — bad lighting used to cause embarrassing false 'no face' flags, so now it's caught up front." Show the light meter, maybe cover the camera briefly to show it going red/bad. |
| 1:15–1:35 | Click Begin Monitoring | Show the live detection overlay (green box on face). "Face presence, multiple-face detection, and head-turn/gaze detection all run on-device — no video ever leaves the browser." |
| 1:35–1:55 | Trigger violations on camera | Exit fullscreen (show lockdown overlay + "reported" message), turn head away from screen and hold it (show gaze flag appear), briefly leave frame (show no-face flag appear). |
| 1:55–2:15 | Switch to organizer dashboard | Show violations appearing live (auto-refresh), summary cards updating (participant count, total violations, high-risk, latency). "The organizer sees all of this live, scoped to just their session — enforced by row-level security on the backend, not just the UI." |
| 2:15–2:30 | Closing | "Everything here — fullscreen lockdown, face/gaze detection, session scoping — runs from a single Chrome extension with no separate install. Repo link and setup instructions in the description." |

## Recording tips
- Use two Chrome **profiles** (not just windows) for organizer vs participant, so cookies/extension storage don't collide — same reason the multi-user test needs separate profiles.
- Record the dashboard in a separate window positioned next to the contest tab so viewers can see cause → effect (trigger violation → appears on dashboard) without cutting away.
- If your webcam light meter is hard to demo convincingly on camera, cover the lens partially with a hand for the "bad lighting" beat instead of trying to dim the room.