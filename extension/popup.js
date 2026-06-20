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

async function initSessionUI() {
  const user = await getCurrentUser();
  if (!user) return;

  if (user.role === "admin") {
    document.getElementById("adminControls").style.display = "block";
  } else {
    document.getElementById("userControls").style.display = "block";
  }
}

document.getElementById("createSessionBtn")?.addEventListener("click", async () => {
  const user = await getCurrentUser();
  const code = generateCode();

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

  const data = await response.json();
  document.getElementById("sessionCode").textContent = "Session Code: " + code;
  chrome.storage.local.set({ activeSession: code });
});

document.getElementById("joinSessionBtn")?.addEventListener("click", async () => {
  const user = await getCurrentUser();
  const code = document.getElementById("joinCodeInput").value.trim().toUpperCase();

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
    document.getElementById("joinStatus").textContent = "Joined session: " + code;
    chrome.storage.local.set({ activeSession: code });
  } else {
    document.getElementById("joinStatus").textContent = "Failed to join — invalid code?";
  }
});

initSessionUI();
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
  
    // Show latest events first
    [...events].reverse().forEach((event) => {
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
  
  // Load and display events
  chrome.storage.local.get(["events"], (result) => {
    renderEvents(result.events || []);
  });
  
  // Clear button
  document.getElementById("clear").addEventListener("click", () => {
    chrome.storage.local.set({ events: [] });
    renderEvents([]);
  });