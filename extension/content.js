function createStartButton() {
  if (document.getElementById("cp-proctor-start-btn")) return;

  const btn = document.createElement("button");
  btn.id = "cp-proctor-start-btn";
  btn.textContent = "Start Contest (Enter Fullscreen)";
  btn.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999998;
    padding: 14px 24px;
    font-size: 15px;
    font-weight: bold;
    background: #569cd6;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-family: Arial, sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  btn.addEventListener("click", () => {
    document.documentElement.requestFullscreen().then(() => {
      btn.remove();
      chrome.runtime.sendMessage({
        type: "CONTEST_STARTED",
        data: { url: window.location.href }
      });
      chrome.storage.local.set({ contestActive: true, contestUrl: window.location.href });
    });
  });

  document.body.appendChild(btn);
}

createStartButton();

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

document.addEventListener("visibilitychange", () => {
  chrome.runtime.sendMessage({
    type: "VISIBILITY_CHANGE",
    data: {
      hidden: document.hidden,
      url: window.location.href
    }
  });
});

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

// ===== Fullscreen Lockdown =====

function createLockdownOverlay() {
  if (document.getElementById("cp-proctor-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "cp-proctor-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.95);
    color: white;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: Arial, sans-serif;
    text-align: center;
  `;
  overlay.innerHTML = `
    <h1 style="color: #f44747;">Fullscreen Required</h1>
    <p>You exited fullscreen mode. This has been reported.</p>
    <button id="cp-reenter-fullscreen" style="
      padding: 12px 24px;
      font-size: 16px;
      background: #569cd6;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      margin-top: 16px;
    ">Re-enter Fullscreen</button>
  `;
  document.body.appendChild(overlay);

  document.getElementById("cp-reenter-fullscreen").addEventListener("click", () => {
    document.documentElement.requestFullscreen();
  });
}

function removeLockdownOverlay() {
  const overlay = document.getElementById("cp-proctor-overlay");
  if (overlay) overlay.remove();
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    chrome.runtime.sendMessage({
      type: "FULLSCREEN_EXIT",
      data: { url: window.location.href }
    });
    createLockdownOverlay();
  } else {
    removeLockdownOverlay();
  }
});