const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function getCurrentUser() {
  return new Promise(resolve => {
    chrome.storage.local.get(["user"], (result) => resolve(result.user));
  });
}

async function getActiveSession() {
  return new Promise(resolve => {
    chrome.storage.local.get(["activeSession"], (result) => resolve(result.activeSession));
  });
}

function show(id, display = "block") {
  document.getElementById(id).style.display = display;
}
function hide(id) {
  document.getElementById(id).style.display = "none";
}

async function refreshUI() {
  const user = await getCurrentUser();
  const activeSession = await getActiveSession();

  hide("signedOutState");
  hide("noSessionState");
  hide("activeSessionState");

  if (!user) {
    hide("userBar");
    show("signedOutState");
    return;
  }

  show("userBar", "flex");
  document.getElementById("userEmail").textContent = `${user.email} (${user.role || "user"})`;

  if (activeSession) {
    show("activeSessionState");
    document.getElementById("activeSessionCode").textContent = activeSession;
  } else {
    show("noSessionState");
    if (user.role === "admin") {
      show("adminControls");
    } else {
      show("userControls");
    }
  }
}

document.getElementById("openLoginBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("login.html") });
});

document.getElementById("signOutBtn")?.addEventListener("click", async () => {
  await chrome.storage.local.remove(["user", "activeSession", "contestActive", "contestOrigin", "kicked"]);
  refreshUI();
});

document.getElementById("leaveSessionBtn")?.addEventListener("click", async () => {
  chrome.runtime.sendMessage({ type: "LEAVE_SESSION" });
  await chrome.storage.local.remove(["activeSession", "contestActive", "contestOrigin", "kicked"]);
  refreshUI();
});

document.getElementById("createSessionBtn")?.addEventListener("click", async () => {
  const user = await getCurrentUser();
  const code = generateCode();

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${user.token}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ code, admin_email: user.email })
    });

    if (!response.ok) throw new Error("Failed to create session");

    chrome.storage.local.set({ activeSession: code });
    refreshUI();
  } catch (err) {
    document.getElementById("joinStatus").textContent = "Could not create session — check your connection and try again.";
  }
});

document.getElementById("joinSessionBtn")?.addEventListener("click", async () => {
  const user = await getCurrentUser();
  const code = document.getElementById("joinCodeInput").value.trim().toUpperCase();

  if (!code) {
    document.getElementById("joinStatus").textContent = "Enter a session code first.";
    return;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/session_members`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${user.token}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ session_code: code, user_email: user.email })
    });

    if (response.ok) {
      chrome.storage.local.set({ activeSession: code });
      refreshUI();
    } else {
      document.getElementById("joinStatus").textContent = "Failed to join — check the code and try again.";
    }
  } catch (err) {
    document.getElementById("joinStatus").textContent = "Could not reach the server — check your connection.";
  }
});

refreshUI();

// ===== Event log (unchanged behavior, just kept separate from session UI) =====
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString();
}

function renderEvents(events) {
  const container = document.getElementById("events");
  container.innerHTML = "";

  if (events.length === 0) {
    container.innerHTML = "<p>No events yet.</p>";
    return;
  }

  [...events].reverse().slice(0, 100).forEach((event) => {
    const div = document.createElement("div");
    div.className = `event ${event.type}`;
    div.innerHTML = `
      <strong>${event.type}</strong>
      <span class="time"> — ${formatTime(event.timestamp)}</span>
      <div>${JSON.stringify(event.data)}</div>
    `;
    container.appendChild(div);
  });
}

chrome.storage.local.get(["events"], (result) => {
  renderEvents(result.events || []);
});

document.getElementById("clear").addEventListener("click", () => {
  chrome.storage.local.set({ events: [] });
  renderEvents([]);
});