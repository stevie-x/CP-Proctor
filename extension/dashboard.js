const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

let currentSessionCode = null;
let refreshTimer = null;
let knownViolationIds = new Set();
let currentUser = null;

async function getCurrentUser() {
  return new Promise(resolve => {
    chrome.storage.local.get(["user"], (result) => resolve(result.user));
  });
}

// For the "latency from violation to dashboard" performance ask: we can't
// measure true end-to-end latency without a push channel, but we CAN
// measure delivery latency for anything that arrived in Supabase before
// this poll — i.e. wall-clock time between when the violation was
// created (created_at) and the moment THIS dashboard first observed it
// (now, at poll time). This is a real, honestly-measured upper bound on
// "how long after a violation happened does the organizer see it",
// bounded below by your poll interval and network round-trip.
let latencySamples = [];
const MAX_LATENCY_SAMPLES = 50;

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function renderSummary(violations) {
  const userCounts = {};
  violations.forEach(v => {
    userCounts[v.user_email] = (userCounts[v.user_email] || 0) + 1;
  });

  const totalUsers = Object.keys(userCounts).length;
  const totalViolations = violations.length;
  const flaggedUsers = Object.values(userCounts).filter(c => c >= 3).length;

  const avgLatency = latencySamples.length
    ? (latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length / 1000).toFixed(1)
    : null;

  document.getElementById("summary").innerHTML = `
    <div class="card"><div class="num">${totalUsers}</div><div class="label">Participants</div></div>
    <div class="card"><div class="num">${totalViolations}</div><div class="label">Total Violations</div></div>
    <div class="card"><div class="num">${flaggedUsers}</div><div class="label">High Risk (3+ violations)</div></div>
    <div class="card"><div class="num">${avgLatency !== null ? avgLatency + "s" : "—"}</div><div class="label">Avg. flag delivery latency (this session)</div></div>
  `;
}

function renderViolations(violations) {
  const tbody = document.getElementById("violationsBody");

  if (violations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No violations recorded for this session</td></tr>`;
    return;
  }

  tbody.innerHTML = violations
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(v => `
      <tr class="${knownViolationIds.has(v.id) ? '' : 'new-row'}">
        <td>${v.user_email}</td>
        <td><span class="badge ${v.violation_type}">${v.violation_type}</span></td>
        <td>${v.details?.reason || v.details?.url || "-"}</td>
        <td>${formatTime(v.created_at)}</td>
      </tr>
    `).join("");
}

function trackLatencyForNewViolations(violations) {
  const now = Date.now();
  violations.forEach(v => {
    if (!knownViolationIds.has(v.id)) {
      const createdAt = new Date(v.created_at).getTime();
      if (!Number.isNaN(createdAt)) {
        latencySamples.push(now - createdAt);
        if (latencySamples.length > MAX_LATENCY_SAMPLES) latencySamples.shift();
      }
      knownViolationIds.add(v.id);
    }
  });
}

async function loadSession(code, { silent } = {}) {
  currentSessionCode = code;

  if (!currentUser) {
    currentUser = await getCurrentUser();
  }
  if (!currentUser) {
    document.getElementById("lastUpdated").textContent =
      "Sign in as the organizer via the extension popup first — the dashboard needs your session to read violations.";
    document.getElementById("violationsBody").innerHTML =
      `<tr><td colspan="4" class="empty">Not signed in</td></tr>`;
    return;
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/violations?session_code=eq.${code}&select=*`,
      {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${currentUser.token}`
        }
      }
    );

    if (response.status === 401 || response.status === 403) {
      document.getElementById("lastUpdated").textContent =
        "Access denied — you can only view violations for sessions you created.";
      return;
    }

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected response");

    trackLatencyForNewViolations(data);
    renderSummary(data);
    renderViolations(data);
    document.getElementById("lastUpdated").textContent =
      "Last updated " + new Date().toLocaleTimeString() + (silent ? " (auto)" : "");
  } catch (err) {
    if (!silent) {
      document.getElementById("lastUpdated").textContent = "Failed to load — check the session code and your connection.";
    }
  }
}

function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const enabled = document.getElementById("autoRefreshToggle").checked;
  if (!enabled || !currentSessionCode) return;

  const intervalMs = parseInt(document.getElementById("refreshInterval").value, 10);
  refreshTimer = setInterval(() => {
    if (currentSessionCode) loadSession(currentSessionCode, { silent: true });
  }, intervalMs);
}

document.getElementById("loadBtn").addEventListener("click", () => {
  const code = document.getElementById("sessionCodeInput").value.trim().toUpperCase();
  if (code) {
    knownViolationIds = new Set();
    latencySamples = [];
    loadSession(code);
    scheduleAutoRefresh();
  }
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  if (currentSessionCode) loadSession(currentSessionCode);
});

document.getElementById("autoRefreshToggle").addEventListener("change", scheduleAutoRefresh);
document.getElementById("refreshInterval").addEventListener("change", scheduleAutoRefresh);