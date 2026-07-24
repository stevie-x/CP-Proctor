const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

// Confirm-password field is only strictly required for sign up, but we
// show it up front so people don't get surprised by a field appearing
// after they've already typed a password once.
const confirmInput = document.getElementById('confirmPassword');
const confirmLabel = document.getElementById('confirmLabel');
confirmInput.style.display = 'block';
confirmLabel.style.display = 'block';

function passwordsMatch() {
  return document.getElementById('password').value === confirmInput.value;
}

confirmInput.addEventListener('input', () => {
  confirmInput.classList.toggle('mismatch', confirmInput.value.length > 0 && !passwordsMatch());
  document.getElementById('mismatchHint').style.display =
    confirmInput.value.length > 0 && !passwordsMatch() ? 'block' : 'none';
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showStatus("Enter your email and password.", "error");
    return;
  }

  try {
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
          // Access tokens expire (Supabase default ~1hr). Without storing
          // this, an expired token means every write silently fails
          // (PGRST303 "JWT expired") until the user manually signs in
          // again — which is exactly the bug that was happening.
          refreshToken: data.refresh_token,
          role: data.user?.user_metadata?.role
        }
      });
      showStatus("Signed in as " + email, "success");
    } else {
      showStatus(data.error_description || data.msg || "Login failed", "error");
    }
  } catch (err) {
    showStatus("Could not reach the server — check your connection.", "error");
  }
});

document.getElementById('signupBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;

  if (!email || !password) {
    showStatus("Enter your email and password.", "error");
    return;
  }
  if (password.length < 6) {
    showStatus("Password must be at least 6 characters.", "error");
    return;
  }
  if (!passwordsMatch()) {
    showStatus("Passwords don't match.", "error");
    confirmInput.classList.add('mismatch');
    document.getElementById('mismatchHint').style.display = 'block';
    return;
  }

  try {
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
  } catch (err) {
    showStatus("Could not reach the server — check your connection.", "error");
  }
});

// ===== Forgot password =====
document.getElementById('forgotLink').addEventListener('click', () => {
  document.getElementById('authPanel').style.display = 'none';
  document.getElementById('forgotPanel').style.display = 'block';
  document.getElementById('status').className = '';
  document.getElementById('forgotEmail').value = document.getElementById('email').value;
});

document.getElementById('backToLoginLink').addEventListener('click', () => {
  document.getElementById('forgotPanel').style.display = 'none';
  document.getElementById('authPanel').style.display = 'block';
  document.getElementById('status').className = '';
});

document.getElementById('sendResetBtn').addEventListener('click', async () => {
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) {
    showStatus("Enter your email first.", "error");
    return;
  }

  // The reset-password.html page (bundled in this extension) is where
  // Supabase will redirect the user after they click the emailed link.
  // NOTE: this exact URL must be added to Supabase's Auth > URL
  // Configuration > Redirect URLs allow-list, or Supabase will reject the
  // redirect and the link in the email won't work. See README.md.
  const redirectTo = chrome.runtime.getURL('reset-password.html');

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    if (response.ok) {
      showStatus("If that email has an account, a reset link has been sent.", "success");
    } else {
      const data = await response.json().catch(() => ({}));
      showStatus(data.error_description || data.msg || "Could not send reset email.", "error");
    }
  } catch (err) {
    showStatus("Could not reach the server — check your connection.", "error");
  }
});