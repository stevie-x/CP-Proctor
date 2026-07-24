#!/usr/bin/env node
// Simulates N participants joining a session and reporting violations
// concurrently, directly against the Supabase REST API — the same
// endpoints the extension itself calls. This validates RLS policies and
// concurrent-write behavior WITHOUT needing N real browser profiles.
//
// It does NOT exercise the extension UI, face detection, or fullscreen —
// pair this with the manual checklist in TESTING.md for full coverage.
//
// Usage:
//   node simulate_participants.js --url <supabase-url> --anon-key <key> \
//     --admin-email admin@test.com --admin-password secret123 \
//     --participants 5 [--violations-per-participant 2] [--session-code XXXX]
//
// Requires Node 18+ (built-in fetch). No dependencies.

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
      if (argv[i].startsWith("--")) {
        const key = argv[i].slice(2);
        const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
        args[key] = val;
      }
    }
    return args;
  }
  
  const args = parseArgs(process.argv.slice(2));
  
  const SUPABASE_URL = args.url;
  const ANON_KEY = args["anon-key"];
  const ADMIN_EMAIL = args["admin-email"];
  const ADMIN_PASSWORD = args["admin-password"];
  const PARTICIPANT_COUNT = parseInt(args.participants || "5", 10);
  const VIOLATIONS_PER_PARTICIPANT = parseInt(args["violations-per-participant"] || "2", 10);
  const PARTICIPANT_PASSWORD = args["participant-password"] || "TestPass123!";
  
  if (!SUPABASE_URL || !ANON_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error("Missing required args. See --help / the header comment in this file.");
    process.exit(1);
  }
  
  function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  
  async function signInOrUp(email, password, role) {
    let res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    let data = await res.json();
  
    if (!data.access_token) {
      // try signup then sign in
      await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, data: { role } })
      });
      res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      data = await res.json();
    }
  
    if (!data.access_token) {
      throw new Error(`Could not authenticate ${email}: ${JSON.stringify(data)}`);
    }
    return data.access_token;
  }
  
  async function createSession(adminToken, adminEmail) {
    const code = generateCode();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ code, admin_email: adminEmail })
    });
    if (!res.ok) throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
    return code;
  }
  
  async function joinSession(token, email, code) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/session_members`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ session_code: code, user_email: email })
    });
    return { ok: res.ok, status: res.status };
  }
  
  async function reportViolation(token, email, code, type) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/violations`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session_code: code,
        user_email: email,
        violation_type: type,
        details: { reason: "simulated", sent_at: Date.now() }
      })
    });
    return { ok: res.ok, status: res.status };
  }
  
  async function readViolationsAsAdmin(adminToken, code) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/violations?session_code=eq.${code}&select=*`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${adminToken}` }
    });
    if (!res.ok) throw new Error(`readViolations failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  
  async function main() {
    console.log(`Signing in admin ${ADMIN_EMAIL}...`);
    const adminToken = await signInOrUp(ADMIN_EMAIL, ADMIN_PASSWORD, "admin");
  
    const code = args["session-code"] || (await createSession(adminToken, ADMIN_EMAIL));
    console.log(`Session code: ${code}`);
  
    console.log(`Signing in/up ${PARTICIPANT_COUNT} participants...`);
    const participants = [];
    for (let i = 0; i < PARTICIPANT_COUNT; i++) {
      const email = `sim-participant-${i + 1}@test.local`;
      const token = await signInOrUp(email, PARTICIPANT_PASSWORD, "user");
      participants.push({ email, token });
    }
  
    console.log(`Joining all ${PARTICIPANT_COUNT} participants concurrently...`);
    const joinResults = await Promise.all(
      participants.map(p => joinSession(p.token, p.email, code))
    );
    const failedJoins = joinResults.filter(r => !r.ok);
    console.log(`  ${joinResults.length - failedJoins.length}/${joinResults.length} joins succeeded`);
    if (failedJoins.length) console.log("  Failures:", failedJoins);
  
    console.log(`Firing ${VIOLATIONS_PER_PARTICIPANT} concurrent violations per participant...`);
    const violationTypes = ["FULLSCREEN_EXIT", "URL_VIOLATION", "FACE_NO_FACE_VIOLATION", "GAZE_VIOLATION"];
    const violationCalls = [];
    for (const p of participants) {
      for (let i = 0; i < VIOLATIONS_PER_PARTICIPANT; i++) {
        violationCalls.push(reportViolation(p.token, p.email, code, violationTypes[i % violationTypes.length]));
      }
    }
    const violationResults = await Promise.all(violationCalls);
    const failedViolations = violationResults.filter(r => !r.ok);
    console.log(`  ${violationResults.length - failedViolations.length}/${violationResults.length} violation writes succeeded`);
    if (failedViolations.length) console.log("  Failures:", failedViolations);
  
    // Give Postgres a moment, then read back as the admin.
    await new Promise(r => setTimeout(r, 1000));
    const stored = await readViolationsAsAdmin(adminToken, code);
  
    const expectedCount = PARTICIPANT_COUNT * VIOLATIONS_PER_PARTICIPANT;
    const ids = new Set(stored.map(v => v.id));
    const duplicates = stored.length - ids.size;
  
    console.log("\n===== RESULTS =====");
    console.log(`Expected violations: ${expectedCount}`);
    console.log(`Stored violations read back by admin: ${stored.length}`);
    console.log(`Duplicate IDs: ${duplicates}`);
  
    const perUserCounts = {};
    stored.forEach(v => { perUserCounts[v.user_email] = (perUserCounts[v.user_email] || 0) + 1; });
    const misattributed = Object.entries(perUserCounts).filter(([email, count]) => count !== VIOLATIONS_PER_PARTICIPANT);
  
    if (stored.length === expectedCount && duplicates === 0 && misattributed.length === 0) {
      console.log("PASS: counts match, no duplicates, no misattribution.");
    } else {
      console.log("MISMATCH — investigate:");
      if (misattributed.length) console.log("  Per-user counts don't match expected:", perUserCounts);
      process.exitCode = 1;
    }
  }
  
  main().catch(err => {
    console.error("Script failed:", err);
    process.exit(1);
  });