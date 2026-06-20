const SUPABASE_URL = "https://hldwnmuptiidijgmuufb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZHdubXVwdGlpZGlqZ211dWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NjEyMzYsImV4cCI6MjA5NzMzNzIzNn0.WuMr_ebkW950OaF8-k25BdlM1F4KRpFvxBMC9wwuC6o";

// Save event to chrome.storage.local
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

// Push a violation to Supabase
async function reportViolation(type, details) {
  const stored = await chrome.storage.local.get(["user", "activeSession"]);
  if (!stored.user || !stored.activeSession) return;

  await fetch(`${SUPABASE_URL}/rest/v1/violations`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${stored.user.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      session_code: stored.activeSession,
      user_email: stored.user.email,
      violation_type: type,
      details: details
    })
  });
  console.log("[CP Proctor] Violation reported to Supabase:", type);
}

const VIOLATION_TYPES = ["URL_VIOLATION", "LOCKDOWN_VIOLATION", "FULLSCREEN_EXIT"];

// Tab switch detection
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    logEvent("TAB_SWITCH", { url: tab.url, title: tab.title });
    checkContestUrl(tab.url);
  });
});

// URL change detection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    logEvent("URL_CHANGE", { url: tab.url, title: tab.title });
    checkContestUrl(tab.url);
  }
});

// HackerRank URL Enforcement
function checkContestUrl(currentUrl) {
  chrome.storage.local.get(["contestActive"], (result) => {
    if (!result.contestActive) return;
    if (!currentUrl) return;

    const isHackerRank = currentUrl.includes("hackerrank.com");
    const isExtensionPage = currentUrl.includes("chrome-extension://");

    if (!isHackerRank && !isExtensionPage) {
      const details = { url: currentUrl, reason: "Navigated away from HackerRank during active contest" };
      logEvent("URL_VIOLATION", details);
      reportViolation("URL_VIOLATION", details);
    }
  });
}

// Receive messages from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logEvent(message.type, message.data);

  if (message.type === "CONTEST_STARTED") {
    chrome.storage.local.set({ contestActive: true });
  }
  if (message.type === "FULLSCREEN_EXIT") {
    const details = { reason: "Exited fullscreen during active contest", url: message.data.url };
    logEvent("LOCKDOWN_VIOLATION", details);
    reportViolation("LOCKDOWN_VIOLATION", details);
  }
});

// ===== Codeforces API =====
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