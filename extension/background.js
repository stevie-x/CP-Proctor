// Event log — stores all suspicious signals
let events = [];

function logEvent(type, data) {
  const event = {
    type: type,
    timestamp: Date.now(),
    data: data
  };
  events.push(event);
  console.log("[CP Proctor]", event);
}

// Tab switch detection
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    logEvent("TAB_SWITCH", { url: tab.url, title: tab.title });
  });
});

// URL change detection within same tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    logEvent("URL_CHANGE", { url: tab.url, title: tab.title });
  }
});