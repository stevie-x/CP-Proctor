const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

let currentSessionCode = null;

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

  document.getElementById("summary").innerHTML = `
    <div class="card"><div class="num">${totalUsers}</div><div class="label">Participants</div></div>
    <div class="card"><div class="num">${totalViolations}</div><div class="label">Total Violations</div></div>
    <div class="card"><div class="num">${flaggedUsers}</div><div class="label">High Risk (3+ violations)</div></div>
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
      <tr>
        <td>${v.user_email}</td>
        <td><span class="badge ${v.violation_type}">${v.violation_type}</span></td>
        <td>${v.details?.reason || v.details?.url || "-"}</td>
        <td>${formatTime(v.created_at)}</td>
      </tr>
    `).join("");
}

async function loadSession(code) {
  currentSessionCode = code;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/violations?session_code=eq.${code}&select=*`,
    {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      }
    }
  );

  const data = await response.json();
  renderSummary(data);
  renderViolations(data);
}

document.getElementById("loadBtn").addEventListener("click", () => {
  const code = document.getElementById("sessionCodeInput").value.trim().toUpperCase();
  if (code) loadSession(code);
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  if (currentSessionCode) loadSession(currentSessionCode);
});