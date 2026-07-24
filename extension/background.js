const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";
const KICK_THRESHOLD = 3;

function logEvent(type, data) {
  const event = {
    type: type,
    timestamp: Date.now(),
    data: data
  };

  chrome.storage.local.get(["events"], (result) => {
    const events = result.events || [];
    events.push(event);
    chrome.storage.local.set({ events: events });
    console.log("[CP Proctor]", event);
  });
}

let violationCount = 0;

// Exchanges a stored refresh_token for a fresh access_token, and updates
// chrome.storage.local so future calls (and other parts of the extension)
// pick up the renewed session too. Returns the new access token, or null
// if refresh itself failed (e.g. refresh token also expired/revoked —
// at that point the user genuinely does need to sign in again).
async function refreshAccessToken(user) {
  if (!user.refreshToken) {
    console.warn("[CP Proctor] No refresh token stored — this account was signed in before token refresh was added. Sign out and back in once to fix this permanently.");
    return null;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: user.refreshToken })
    });

    if (!res.ok) {
      console.error("[CP Proctor] Token refresh failed — refresh token itself may be expired/revoked. User needs to sign in again.");
      return null;
    }

    const data = await res.json();
    const updatedUser = { ...user, token: data.access_token, refreshToken: data.refresh_token };
    await chrome.storage.local.set({ user: updatedUser });
    console.log("[CP Proctor] Access token refreshed successfully.");
    return data.access_token;
  } catch (err) {
    console.error("[CP Proctor] Network error while refreshing token:", err);
    return null;
  }
}

async function postViolationOnce(token, activeSession, userEmail, type, details) {
  return fetch(`${SUPABASE_URL}/rest/v1/violations`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session_code: activeSession,
      user_email: userEmail,
      violation_type: type,
      details: details
    })
  });
}

async function reportViolation(type, details) {
  const stored = await chrome.storage.local.get(["user", "activeSession"]);
  if (!stored.user || !stored.activeSession) {
    console.warn("[CP Proctor] Not reporting violation — no signed-in user or active session in storage.");
    return;
  }

  let response;
  try {
    response = await postViolationOnce(stored.user.token, stored.activeSession, stored.user.email, type, details);
  } catch (networkErr) {
    console.error("[CP Proctor] Network error reporting violation:", networkErr);
    return;
  }

  // fetch() only rejects on network failure — it does NOT reject on 4xx/5xx,
  // so without checking response.ok, a rejected insert (RLS mismatch, bad
  // column, or an expired token — PGRST303 "JWT expired") would silently
  // log as "reported" while nothing actually landed in the table.
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "(could not read response body)");
    const isExpiredJwt = errorBody.includes("PGRST303") || errorBody.includes("JWT expired");

    if (isExpiredJwt) {
      console.warn("[CP Proctor] Access token expired — attempting silent refresh and retry...");
      const newToken = await refreshAccessToken(stored.user);
      if (newToken) {
        try {
          const retryResponse = await postViolationOnce(newToken, stored.activeSession, stored.user.email, type, details);
          if (retryResponse.ok) {
            console.log("[CP Proctor] Violation reported to Supabase after token refresh:", type);
          } else {
            const retryErrorBody = await retryResponse.text().catch(() => "(could not read response body)");
            console.error(`[CP Proctor] Retry after token refresh still failed — status ${retryResponse.status}. Response: ${retryErrorBody}`);
            return;
          }
        } catch (retryErr) {
          console.error("[CP Proctor] Network error retrying violation after token refresh:", retryErr);
          return;
        }
      } else {
        console.error("[CP Proctor] Could not refresh token — violation NOT saved. User should sign out and back in.");
        return;
      }
    } else {
      console.error(
        `[CP Proctor] Supabase REJECTED the violation insert — status ${response.status}. ` +
        `This usually means an RLS policy blocked it, or the request body doesn't match your table's columns. ` +
        `Response body: ${errorBody}`
      );
      return;
    }
  } else {
    console.log("[CP Proctor] Violation reported to Supabase:", type);
  }

  violationCount++;
  console.log("[CP Proctor] Violation count:", violationCount);

  if (violationCount >= KICK_THRESHOLD) {
    // contestActive alone wasn't enough to actually stop a restart — it's
    // only checked by the URL/lockdown violation logic, not by the "Start
    // Contest" button itself, so nothing was preventing an immediate
    // restart right after being kicked. This flag is checked directly by
    // content.js's start button.
    chrome.storage.local.set({ contestActive: false, kicked: true });
    chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: "KICKED" }, () => {
          // Scoping the query to http/https tabs above avoids most of
          // these, but a tab can still navigate/close between query and
          // send. Reading lastError here (without acting on it) prevents
          // Chrome's "Unchecked runtime.lastError" console spam for the
          // remaining harmless cases.
          void chrome.runtime.lastError;
        });
      });
    });
  }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    logEvent("TAB_SWITCH", { url: tab.url, title: tab.title });
    checkContestUrl(tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    logEvent("URL_CHANGE", { url: tab.url, title: tab.title });
    checkContestUrl(tab.url);
  }
});

// Bug this fixes: the old check hardcoded "hackerrank.com", so anyone
// running a contest on Codeforces (or anywhere else) got flagged on every
// single tab update — 100% false positive rate off HackerRank. It also
// matched "chrome-extension://" as a raw substring, which technically
// works but would silently also whitelist any OTHER installed extension's
// pages, not just this one. Both are fixed below: we compare against the
// actual contest tab's origin (captured when the contest started) and
// scope the extension-page exclusion to this extension's own ID.
const OWN_EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}/`;

function checkContestUrl(currentUrl) {
  chrome.storage.local.get(["contestActive", "contestOrigin"], (result) => {
    if (!result.contestActive) return;
    if (!currentUrl) return;

    const isOwnExtensionPage = currentUrl.startsWith(OWN_EXTENSION_ORIGIN);
    if (isOwnExtensionPage) return; // webcam.html / dashboard.html / popup.html etc — never a violation

    let isSameOriginAsContest = false;
    if (result.contestOrigin) {
      try {
        isSameOriginAsContest = new URL(currentUrl).origin === result.contestOrigin;
      } catch (e) {
        isSameOriginAsContest = false;
      }
    }

    if (!isSameOriginAsContest) {
      const details = { url: currentUrl, contest_origin: result.contestOrigin, reason: "Navigated away from the contest page during an active contest" };
      logEvent("URL_VIOLATION", details);
      reportViolation("URL_VIOLATION", details);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logEvent(message.type, message.data);

  if (message.type === "CONTEST_STARTED") {
    let origin = null;
    try {
      origin = new URL(message.data.url).origin;
    } catch (e) {
      origin = null;
    }
    chrome.storage.local.set({ contestActive: true, contestOrigin: origin });
    violationCount = 0;
  }

  if (message.type === "OPEN_WEBCAM") {
    chrome.tabs.create({ url: chrome.runtime.getURL("webcam.html") });
  }

  if (message.type === "FULLSCREEN_EXIT") {
    const details = { reason: "Exited fullscreen during active contest", url: message.data.url };
    logEvent("LOCKDOWN_VIOLATION", details);
    reportViolation("LOCKDOWN_VIOLATION", details);
  }

  if (
    message.type === "FACE_NO_FACE_VIOLATION" ||
    message.type === "FACE_MULTIPLE_VIOLATION" ||
    message.type === "GAZE_VIOLATION"
  ) {
    reportViolation(message.type, message.data);
  }

  if (message.type === "LEAVE_SESSION") {
    chrome.storage.local.remove(["activeSession", "contestActive", "contestOrigin", "kicked"]);
    violationCount = 0;
  }
});

const CF_HANDLE = "stevie_x";
const CF_API = "https://codeforces.com/api";

async function fetchRecentSubmissions() {
  const response = await fetch(
    `${CF_API}/user.status?handle=${CF_HANDLE}&from=1&count=10`
  );
  const data = await response.json();

  if (data.status !== "OK") {
    console.log("[CP Proctor] CF API error:", data.comment);
    return;
  }

  const submissions = data.result.map((s) => ({
    id: s.id,
    problem: s.problem.name,
    verdict: s.verdict,
    timestamp: s.creationTimeSeconds * 1000
  }));

  chrome.storage.local.set({ submissions: submissions });
  console.log("[CP Proctor] Submissions fetched:", submissions);
}

async function fetchContestStatus() {
  const response = await fetch(
    `${CF_API}/user.rating?handle=${CF_HANDLE}`
  );
  const data = await response.json();

  if (data.status !== "OK") return;

  const lastContest = data.result[data.result.length - 1];
  chrome.storage.local.set({ lastContest: lastContest });
  console.log("[CP Proctor] Last contest:", lastContest);
}

function computeRiskScore() {
  chrome.storage.local.get(["events", "submissions"], (result) => {
    const events = result.events || [];
    const submissions = result.submissions || [];

    const acceptedSubs = submissions.filter(s => s.verdict === "OK");
    const flagged = [];

    acceptedSubs.forEach(sub => {
      const window = events.filter(e =>
        e.timestamp <= sub.timestamp &&
        e.timestamp >= sub.timestamp - 120000
      );
      if (window.length > 0) {
        flagged.push({ submission: sub, events: window });
      }
    });

    chrome.storage.local.set({ flagged: flagged });
    console.log("[CP Proctor] Flagged windows:", flagged);
  });
}

fetchRecentSubmissions().then(computeRiskScore);
fetchContestStatus();
setInterval(fetchRecentSubmissions, 30000);