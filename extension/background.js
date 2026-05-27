// Save event to chrome.storage.local
function logEvent(type, data) {
  const event = {
    type: type,
    timestamp: Date.now(),
    data: data
  };

  // Read existing events, append new one, save back
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
  });
});

// URL change detection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    logEvent("URL_CHANGE", { url: tab.url, title: tab.title });
  }
});

// Receive messages from content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logEvent(message.type, message.data);
});