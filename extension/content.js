// Keystroke timing
let lastKeyTime = null;

document.addEventListener("keydown", (e) => {
  const now = Date.now();
  const interval = lastKeyTime ? now - lastKeyTime : null;
  lastKeyTime = now;

  chrome.runtime.sendMessage({
    type: "KEYSTROKE",
    data: {
      key: e.key,
      interval_ms: interval
    }
  });
});

// Visibility change — user left the tab
document.addEventListener("visibilitychange", () => {
  chrome.runtime.sendMessage({
    type: "VISIBILITY_CHANGE",
    data: {
      hidden: document.hidden,
      url: window.location.href
    }
  });
});

// Paste detection
document.addEventListener("paste", (e) => {
  const text = e.clipboardData.getData("text");
  chrome.runtime.sendMessage({
    type: "PASTE_EVENT",
    data: {
      length: text.length,
      url: window.location.href
    }
  });
});