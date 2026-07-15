// CP Proctor — Webcam Monitor
// Loads TinyFaceDetector from the model files bundled inside the extension
// (chrome.runtime.getURL, NOT a CDN — CDN fetches get blocked by MV3 CSP)
// and flags "no face" / "multiple faces" the same way content.js/background.js
// already flag URL and fullscreen violations.

const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const flagBanner = document.getElementById("flagBanner");

const MODEL_URL = chrome.runtime.getURL("models");

// --- Workaround for a face-api.js / TensorFlow.js bug ---
// The URL parser used to build model file paths only recognizes
// "http://" and "https://" as valid protocols. For any other scheme —
// including "chrome-extension://" — it strips one of the two slashes
// when rebuilding the URL, turning "chrome-extension://ID/models/x.json"
// into the invalid "chrome-extension:/ID/models/x.json", which makes
// fetch() throw "Failed to fetch".
//
// This affects TWO separate fetch paths:
//   1. face-api.js's own env.fetch (used to load the manifest .json)
//   2. TensorFlow.js's internal platform.fetch (used to load the actual
//      binary shard file) — a different reference that face-api.js's
//      monkeyPatch does NOT cover.
// The simplest fix that covers both is to patch window.fetch itself,
// since both of those code paths ultimately call through to it.
const nativeFetch = window.fetch.bind(window);
window.fetch = (url, init) => {
  if (typeof url === "string" && url.startsWith("chrome-extension:/") && !url.startsWith("chrome-extension://")) {
    url = url.replace("chrome-extension:/", "chrome-extension://");
  }
  return nativeFetch(url, init);
};

// How many consecutive "bad" detection ticks (see DETECT_INTERVAL_MS) before
// we actually flag a violation. This avoids false positives from a single
// dropped frame or someone briefly leaning out of frame.
const DETECT_INTERVAL_MS = 1000;
const NO_FACE_STREAK_THRESHOLD = 5;   // ~5 seconds of no face
const MULTI_FACE_STREAK_THRESHOLD = 2; // ~2 seconds of multiple faces

let noFaceStreak = 0;
let multiFaceStreak = 0;
let noFaceFlaggedAt = 0;
let multiFaceFlaggedAt = 0;
const RE_FLAG_COOLDOWN_MS = 15000; // don't spam the same violation repeatedly

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || "";
}

function showFlag(msg) {
  flagBanner.textContent = msg;
  flagBanner.style.display = "block";
}

function clearFlag() {
  flagBanner.style.display = "none";
}

function reportFaceViolation(type, details) {
  chrome.runtime.sendMessage({
    type: type, // "FACE_NO_FACE_VIOLATION" | "FACE_MULTIPLE_VIOLATION"
    data: details
  });
}

async function loadModels() {
  try {
    const manifestUrl = chrome.runtime.getURL("models/tiny_face_detector_model-weights_manifest.json");
    const shardUrl = chrome.runtime.getURL("models/tiny_face_detector_model-shard1");

    console.log("[CP Proctor] Fetching manifest...");
    const manifestRes = await nativeFetch(manifestUrl);
    const manifest = await manifestRes.json();

    console.log("[CP Proctor] Fetching shard...");
    const shardRes = await nativeFetch(shardUrl);
    const shardBuffer = await shardRes.arrayBuffer();
    console.log("[CP Proctor] Shard loaded, bytes:", shardBuffer.byteLength);

    const weightMap = await faceapi.tf.io.decodeWeights(shardBuffer, manifest[0].weights);
    console.log("[CP Proctor] Weight map created");

    await faceapi.nets.tinyFaceDetector.loadFromWeightMap(weightMap);
    console.log("[CP Proctor] Model loaded successfully");
    setStatus("Model loaded — starting camera…", "ok");
  } catch (err) {
    console.error("[CP Proctor] Model load failed:", err);
    setStatus("Model load failed: " + err.message, "error");
    throw err;
  }
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 360 },
      audio: false
    });
    video.srcObject = stream;
    return new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });
  } catch (err) {
    console.error("[CP Proctor] Camera access failed:", err);
    setStatus("Camera access failed: " + err.message, "error");
    throw err;
  }
}

function drawDetections(detections) {
  const ctx = overlay.getContext("2d");
  overlay.width = video.videoWidth || 480;
  overlay.height = video.videoHeight || 360;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  detections.forEach((d) => {
    const { x, y, width, height } = d.box;
    ctx.strokeStyle = detections.length > 1 ? "#f44747" : "#6a9955";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
  });
}

async function detectLoop() {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224 });
  const detections = await faceapi.detectAllFaces(video, options);
  drawDetections(detections);

  const now = Date.now();

  // ----- No face -----
  if (detections.length === 0) {
    noFaceStreak++;
    multiFaceStreak = 0;
    if (noFaceStreak >= NO_FACE_STREAK_THRESHOLD) {
      if (now - noFaceFlaggedAt > RE_FLAG_COOLDOWN_MS) {
        noFaceFlaggedAt = now;
        showFlag("No face detected");
        reportFaceViolation("FACE_NO_FACE_VIOLATION", {
          reason: "No face detected in webcam for sustained period"
        });
      }
    }
  }
  // ----- Multiple faces -----
  else if (detections.length > 1) {
    multiFaceStreak++;
    noFaceStreak = 0;
    if (multiFaceStreak >= MULTI_FACE_STREAK_THRESHOLD) {
      if (now - multiFaceFlaggedAt > RE_FLAG_COOLDOWN_MS) {
        multiFaceFlaggedAt = now;
        showFlag("Multiple faces detected");
        reportFaceViolation("FACE_MULTIPLE_VIOLATION", {
          reason: "Multiple faces detected in webcam",
          face_count: detections.length
        });
      }
    }
  }
  // ----- Normal (exactly one face) -----
  else {
    noFaceStreak = 0;
    multiFaceStreak = 0;
    clearFlag();
  }

  setTimeout(detectLoop, DETECT_INTERVAL_MS);
}

(async function init() {
  try {
    await loadModels();
    await startCamera();
    setStatus("Monitoring active", "ok");
    detectLoop();
  } catch (err) {
    // status already set by whichever step failed
  }
})();