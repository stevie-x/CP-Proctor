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

// ===== HackerRank URL Enforcement =====
function checkContestUrl(currentUrl) {
  chrome.storage.local.get(["contestActive"], (result) => {
    if (!result.contestActive) return;
    if (!currentUrl) return;

    const isHackerRank = currentUrl.includes("hackerrank.com");
    const isExtensionPage = currentUrl.includes("chrome-extension://");

    if (!isHackerRank && !isExtensionPage) {
      logEvent("URL_VIOLATION", { url: currentUrl, reason: "Navigated away from HackerRank during active contest" });
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
    logEvent("LOCKDOWN_VIOLATION", { reason: "Exited fullscreen during active contest", url: message.data.url });
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