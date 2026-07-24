-- CP Proctor — Row Level Security policies
-- ============================================================
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query).
-- Right now these tables have RLS OFF, which means anyone with your
-- project's anon key (visible in the extension's source — anyone who
-- installs it has it) can read and write every row in every table.
-- This file locks that down to match what the extension actually needs.
--
-- Assumed schema (adjust column names if yours differ):
--   sessions(code text primary key, admin_email text, created_at timestamptz default now())
--   session_members(id ..., session_code text, user_email text, joined_at timestamptz default now())
--   violations(id ..., session_code text, user_email text, violation_type text, details jsonb, created_at timestamptz default now())
-- ============================================================

alter table sessions enable row level security;
alter table session_members enable row level security;
alter table violations enable row level security;

-- ---------- sessions ----------

-- Anyone signed in can look up a session by code (needed so a participant
-- can validate a code before joining). This only exposes code + admin
-- email, not violation data, so it's low-risk.
create policy "sessions_select_authenticated"
on sessions for select
to authenticated
using (true);

-- Only the creator can create a session under their own email — stops
-- someone from creating a session and impersonating a different admin.
create policy "sessions_insert_own"
on sessions for insert
to authenticated
with check (admin_email = auth.jwt() ->> 'email');

-- Only the admin who owns a session can modify or delete it.
create policy "sessions_update_own"
on sessions for update
to authenticated
using (admin_email = auth.jwt() ->> 'email')
with check (admin_email = auth.jwt() ->> 'email');

create policy "sessions_delete_own"
on sessions for delete
to authenticated
using (admin_email = auth.jwt() ->> 'email');


-- ---------- session_members ----------

-- A participant can only ever join a session AS THEMSELVES — stops
-- someone from adding arbitrary emails to a session's member list.
create policy "session_members_insert_self"
on session_members for insert
to authenticated
with check (user_email = auth.jwt() ->> 'email');

-- A participant can see their own membership row; the admin of the
-- session can see the full member list for their own session.
create policy "session_members_select_self_or_admin"
on session_members for select
to authenticated
using (
  user_email = auth.jwt() ->> 'email'
  or exists (
    select 1 from sessions s
    where s.code = session_members.session_code
      and s.admin_email = auth.jwt() ->> 'email'
  )
);


-- ---------- violations ----------

-- The extension always reports violations as the signed-in participant —
-- this stops anyone from writing fake violations under someone else's
-- email.
create policy "violations_insert_self"
on violations for insert
to authenticated
with check (user_email = auth.jwt() ->> 'email');

-- A participant can see their own violation history; the admin of the
-- session can see all violations reported for their own session (this is
-- what the organizer dashboard needs — dashboard.js now reads with the
-- signed-in admin's token instead of the bare anon key, which is required
-- for this policy to actually apply to it).
create policy "violations_select_self_or_admin"
on violations for select
to authenticated
using (
  user_email = auth.jwt() ->> 'email'
  or exists (
    select 1 from sessions s
    where s.code = violations.session_code
      and s.admin_email = auth.jwt() ->> 'email'
  )
);

-- No update/delete policies on violations for anyone — violation records
-- should be immutable once written (an organizer shouldn't be able to
-- edit evidence, and a participant definitely shouldn't).


-- ============================================================
-- After running this, test with:
--   1. Sign in as a participant, join a session, trigger a violation
--      (e.g. exit fullscreen) — confirm it still gets written.
--   2. Sign in as the admin who created that session, open the
--      dashboard, load the session code — confirm violations still show.
--   3. Sign in as a DIFFERENT admin (or a participant not in the
--      session) and try loading that same session code in the dashboard
--      — confirm it now returns nothing / access denied instead of
--      leaking the first admin's data.
-- ============================================================