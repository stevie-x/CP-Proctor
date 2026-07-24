# Multi-user testing checklist

I can't run a live 5-participant test from here — there's no browser, no webcams, and no real Chrome profiles in this environment. What I *can* do is give you a checklist that actually exercises the parts of the system that break under concurrency, plus a script (`scripts/simulate_participants.js`) that hits the Supabase backend directly to validate the DB/RLS side without needing 5 physical machines.

## Manual test (do this yourself, ~20 min)

You need 5 separate Chrome **profiles** (not just tabs — `chrome.storage.local` and cookies are per-profile, so tabs in the same profile will collide). Chrome menu → profile icon → Add.

1. **Setup**
   - Profile A: sign up as `admin@test.com`, role Admin.
   - Profiles B–F: sign up as `p1@test.com` … `p5@test.com`, role Participant.
   - Load the unpacked extension in all 6 profiles.

2. **Session creation**
   - Profile A: Create Session, note the code.
   - Profiles B–F: join with that code, roughly at the same time (within a few seconds of each other) — this is the concurrency case worth watching for errors.
   - Expected: all 5 joins succeed, no duplicate-key or 409 errors in each profile's popup.

3. **Simultaneous violations**
   - In profiles B–F, open the same contest URL, click Start Contest, and within the same ~10 second window: exit fullscreen (all 5 at once), navigate away from the contest tab (all 5 at once).
   - Expected: 10 violations total appear in Profile A's dashboard (2 per participant), each correctly attributed to the right `user_email`.

4. **Dashboard correctness under load**
   - While B–F are still triggering webcam violations (no face / gaze), watch Profile A's dashboard auto-refresh.
   - Expected: participant count = 5, total violations grows monotonically, high-risk count updates once any participant crosses 3 violations, no violations attributed to the wrong user, no duplicate rows.

5. **Kick behavior**
   - Let one participant (say p3) rack up 3+ violations.
   - Expected: p3's tab shows the "removed from contest" screen; p1/p2/p4/p5 are unaffected.

Record what you actually see (screenshots, timestamps, any errors in each profile's console) — that's your real multi-user evidence, more credible than a claim without it.

## Automated backend check (validates RLS + concurrency without 5 browsers)

`scripts/simulate_participants.js` uses `fetch` against the same Supabase REST endpoints the extension uses, so it validates the actual RLS policies and constraint behavior under concurrent writes — the part most likely to silently break under load. It does **not** exercise face detection, the UI, or fullscreen — that still needs the manual test above.

```bash
node scripts/simulate_participants.js \
  --url https://YOUR_PROJECT.supabase.co \
  --anon-key YOUR_ANON_KEY \
  --admin-email admin@test.com --admin-password ... \
  --participants 5
```

It will: sign in the admin, create a session, sign in (or sign up) N participant accounts, join them all concurrently, fire concurrent violations from each, then read back the violations as the admin and print whether the count matches `N participants × violations per participant`, flagging any mismatches, duplicate IDs, or requests that failed under concurrency.