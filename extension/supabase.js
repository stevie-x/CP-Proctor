const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

async function supabaseFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });
  return response.json();
}

async function supabaseAuth(endpoint, body) {
  const url = `${SUPABASE_URL}/auth/v1/${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function signUp(email, password, role) {
  const data = await supabaseAuth("signup", {
    email,
    password,
    data: { role }
  });
  console.log("[CP Proctor] Signup:", data);
  return data;
}

async function signIn(email, password) {
  const data = await supabaseAuth("token?grant_type=password", {
    email,
    password
  });
  console.log("[CP Proctor] Signin:", data);
  if (data.access_token) {
    chrome.storage.local.set({
      user: {
        email,
        token: data.access_token,
        role: data.user?.user_metadata?.role
      }
    });
  }
  return data;
}

async function signOut() {
  chrome.storage.local.remove("user");
  console.log("[CP Proctor] Signed out");
}