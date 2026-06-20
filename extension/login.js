const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();

  if (data.access_token) {
    chrome.storage.local.set({
      user: {
        email,
        token: data.access_token,
        role: data.user?.user_metadata?.role
      }
    });
    showStatus("Signed in as " + email, "success");
  } else {
    showStatus(data.error_description || "Login failed", "error");
  }
});

document.getElementById('signupBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, data: { role } })
  });

  const data = await response.json();

  if (data.id || data.user) {
    showStatus("Account created! Please sign in.", "success");
  } else {
    showStatus(data.error_description || data.msg || "Signup failed", "error");
  }
});