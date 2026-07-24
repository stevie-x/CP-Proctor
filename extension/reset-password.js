const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

// Supabase redirects back here with the recovery session in the URL
// fragment, e.g. #access_token=...&type=recovery&refresh_token=...
function parseHashParams() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  return {
    accessToken: params.get('access_token'),
    type: params.get('type')
  };
}

const { accessToken, type } = parseHashParams();

if (!accessToken || type !== 'recovery') {
  document.getElementById('formPanel').style.display = 'none';
  showStatus("This page must be opened from the password reset link in your email.", "error");
} else {
  const newPasswordInput = document.getElementById('newPassword');
  const confirmInput = document.getElementById('confirmNewPassword');

  function passwordsMatch() {
    return newPasswordInput.value === confirmInput.value;
  }

  confirmInput.addEventListener('input', () => {
    const mismatch = confirmInput.value.length > 0 && !passwordsMatch();
    confirmInput.classList.toggle('mismatch', mismatch);
    document.getElementById('mismatchHint').style.display = mismatch ? 'block' : 'none';
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    const newPassword = newPasswordInput.value;

    if (newPassword.length < 6) {
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
      const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password: newPassword })
      });

      if (response.ok) {
        document.getElementById('formPanel').style.display = 'none';
        showStatus("Password updated. You can close this tab and sign in.", "success");
      } else {
        const data = await response.json().catch(() => ({}));
        showStatus(data.error_description || data.msg || "Could not update password.", "error");
      }
    } catch (err) {
      showStatus("Could not reach the server — check your connection.", "error");
    }
  });
}