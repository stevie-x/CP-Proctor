// CP Proctor — Webcam Monitor
// Loads TinyFaceDetector + a tiny 68-point landmark model from files bundled
// inside the extension (chrome.runtime.getURL, NOT a CDN — CDN fetches are
// blocked by MV3 CSP), then runs a two-stage flow:
//   1. Calibration — checks lighting is good enough before the contest
//      starts, so we don't spend the whole contest false-flagging someone
//      sitting in a dim room.
//   2. Monitoring — face presence, multiple faces, and gaze/head-turn
//      detection, all reported through the same violation pipeline
//      background.js already uses for URL/fullscreen violations.

const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const flagBanner = document.getElementById("flagBanner");
const calibrationScreen = document.getElementById("calibrationScreen");
const monitorScreen = document.getElementById("monitorScreen");
const lightMeterFill = document.getElementById("lightMeterFill");
const lightMeterLabel = document.getElementById("lightMeterLabel");
const beginBtn = document.getElementById("beginBtn");
const perfStatsEl = document.getElementById("perfStats");

// --- Workaround for a face-api.js / TensorFlow.js URL bug ---
// The library's URL parser only recognizes "http://"/"https://". For
// "chrome-extension://" it collapses the double slash into one, producing
// an invalid URL that fetch() rejects with "Failed to fetch". Not used for
// model loading anymore (we fetch + decode weights manually below), but
// kept because face-api.js's own internals still call fetch for other
// bookkeeping in some code paths, so this keeps things safe.
const nativeFetch = window.fetch.bind(window);
window.fetch = (url, init) => {
  if (typeof url === "string" && url.startsWith("chrome-extension:/") && !url.startsWith("chrome-extension://")) {
    url = url.replace("chrome-extension:/", "chrome-extension://");
  }
  return nativeFetch(url, init);
};

// ===== Tuning constants =====
const DETECT_INTERVAL_MS = 1000;
const NO_FACE_STREAK_THRESHOLD = 5;      // ~5s of no face before flagging
const MULTI_FACE_STREAK_THRESHOLD = 2;   // ~2s of multiple faces
const GAZE_STREAK_THRESHOLD = 4;         // ~4s of sustained looking-away
const RE_FLAG_COOLDOWN_MS = 15000;       // don't spam the same violation

// Lighting thresholds (0-255 average luminance). Anything below MIN is too
// dark to trust face detection; anything above MAX is blown out (backlit).
const LIGHT_MIN = 60;
const LIGHT_MAX = 235;
const LIGHT_GOOD_MIN = 80;   // calibration screen requires this to enable Start
const LIGHT_GOOD_MAX = 220;

// Gaze / head-turn thresholds. These use a simple 2D landmark ratio, not
// true iris tracking (the tiny model doesn't give us pupil position), but
// it reliably catches sustained head turns toward a second screen or phone.
// Tuned from real measured values (see console debug logging in
// estimateGazeAway's caller): resting/forward sits around 0.93-1.16,
// genuine turns reached 0.68-0.78 one direction and 1.36-1.98 the other.
const GAZE_HORIZONTAL_RATIO_LOW = 0.80;
const GAZE_HORIZONTAL_RATIO_HIGH = 1.35;
const GAZE_VERTICAL_DROP_RATIO = 1.7; // chin-to-eye vs eye-to-brow-proxy

let noFaceStreak = 0;
let multiFaceStreak = 0;
let gazeAwayStreak = 0;
let noFaceFlaggedAt = 0;
let multiFaceFlaggedAt = 0;
let gazeFlaggedAt = 0;
let currentLightLevel = null;
let monitoring = false;

// Rolling perf stats (for the "performance numbers" ask) — see PERF section.
const perf = {
  frameTimes: [],       // ms per detectLoop iteration
  maxSamples: 60
};

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

function reportViolation(type, details) {
  chrome.runtime.sendMessage({
    type: type,
    data: { ...details, client_sent_at: Date.now() }
  });
}

// ===== Manual model loading (works around the loadFromUri bug in
// chrome-extension:// contexts) =====
async function loadModelManual(net, folderPrefix) {
  const manifestUrl = chrome.runtime.getURL(`models/${folderPrefix}-weights_manifest.json`);
  const shardUrl = chrome.runtime.getURL(`models/${folderPrefix}-shard1`);

  const manifestRes = await nativeFetch(manifestUrl);
  const manifest = await manifestRes.json();

  const shardRes = await nativeFetch(shardUrl);
  const shardBuffer = await shardRes.arrayBuffer();

  const weightMap = await faceapi.tf.io.decodeWeights(shardBuffer, manifest[0].weights);
  await net.loadFromWeightMap(weightMap);
}

async function loadModels() {
  try {
    setStatus("Loading face detection model…");
    await loadModelManual(faceapi.nets.tinyFaceDetector, "tiny_face_detector_model");

    setStatus("Loading landmark model…");
    await loadModelManual(faceapi.nets.faceLandmark68TinyNet, "face_landmark_68_tiny_model");

    console.log("[CP Proctor] Models loaded successfully");
    setStatus("Models loaded — starting camera…", "ok");
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

// ===== Lighting =====
// Samples the current video frame onto an offscreen canvas and returns
// average luminance (0-255). Cheap enough to run every tick alongside
// detection.
const lightCanvas = document.createElement("canvas");
lightCanvas.width = 80;
lightCanvas.height = 60;
const lightCtx = lightCanvas.getContext("2d", { willReadFrequently: true });

function sampleLightLevel() {
  if (!video.videoWidth) return null;
  lightCtx.drawImage(video, 0, 0, lightCanvas.width, lightCanvas.height);
  const { data } = lightCtx.getImageData(0, 0, lightCanvas.width, lightCanvas.height);
  let sum = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    // standard luminance weighting
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / pixelCount;
}

function lightQualityLabel(level) {
  if (level < LIGHT_MIN) return { label: "Too dark", cls: "bad" };
  if (level > LIGHT_MAX) return { label: "Too bright / backlit", cls: "bad" };
  if (level < LIGHT_GOOD_MIN || level > LIGHT_GOOD_MAX) return { label: "Marginal", cls: "warn" };
  return { label: "Good", cls: "good" };
}

function updateLightMeter(level) {
  const pct = Math.max(0, Math.min(100, (level / 255) * 100));
  lightMeterFill.style.width = pct + "%";
  const q = lightQualityLabel(level);
  lightMeterLabel.textContent = `${q.label} (${Math.round(level)}/255)`;
  lightMeterLabel.className = q.cls;
  lightMeterFill.className = "fill " + q.cls;
  return q;
}

// ===== Calibration screen loop =====
function runCalibrationLoop() {
  if (monitoring) return; // stop once we've moved to monitoring
  const level = sampleLightLevel();
  if (level != null) {
    currentLightLevel = level;
    const q = updateLightMeter(level);
    beginBtn.disabled = q.cls === "bad";
    beginBtn.title = q.cls === "bad"
      ? "Improve lighting before starting — face detection will be unreliable otherwise"
      : "";
  }
  requestAnimationFrame(runCalibrationLoop);
}

// ===== Gaze estimation from 68-point landmarks =====
// Uses simple horizontal/vertical distance ratios between nose, eye
// corners, and chin. This is a head-pose proxy, not true iris tracking,
// but reliably catches sustained turns toward a phone/second monitor.
function estimateGazeAway(landmarks) {
  const pts = landmarks.positions;
  const leftEyeOuter = pts[36];
  const rightEyeOuter = pts[45];
  const nose = pts[33];
  const chin = pts[8];
  const browProxy = pts[27]; // top of nose bridge, near brow line

  const distToLeft = Math.hypot(nose.x - leftEyeOuter.x, nose.y - leftEyeOuter.y);
  const distToRight = Math.hypot(nose.x - rightEyeOuter.x, nose.y - rightEyeOuter.y);
  const horizontalRatio = distToLeft / distToRight;

  const eyeLineY = (leftEyeOuter.y + rightEyeOuter.y) / 2;
  const chinDrop = chin.y - eyeLineY;
  const browRise = eyeLineY - browProxy.y;
  // Guard: during a head turn, landmark foreshortening can shrink browRise
  // toward zero, which blows up chinDrop/browRise into meaningless huge
  // numbers (seen in testing: values like 279 instead of a sane ~1-3
  // range). Only trust the vertical check when browRise is large enough
  // to be a stable denominator; otherwise fall back to "not looking down"
  // for this frame and let the horizontal check (which stays numerically
  // stable) do the work instead.
  const MIN_BROW_RISE_PX = 8;
  const verticalRatio = browRise > MIN_BROW_RISE_PX ? chinDrop / browRise : 1;

  const turnedAway = horizontalRatio < GAZE_HORIZONTAL_RATIO_LOW || horizontalRatio > GAZE_HORIZONTAL_RATIO_HIGH;
  const lookedDown = verticalRatio > GAZE_VERTICAL_DROP_RATIO;

  return { away: turnedAway || lookedDown, horizontalRatio, verticalRatio };
}

function drawDetection(detection, gazeAway) {
  const ctx = overlay.getContext("2d");
  overlay.width = video.videoWidth || 480;
  overlay.height = video.videoHeight || 360;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!detection) return;

  const { x, y, width, height } = detection.detection.box;
  ctx.strokeStyle = gazeAway ? "#dcdcaa" : "#6a9955";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}

// ===== Main detection loop (runs after calibration passes) =====
async function detectLoop() {
  const frameStart = performance.now();

  const level = sampleLightLevel();
  if (level != null) currentLightLevel = level;
  const lightBad = currentLightLevel != null && (currentLightLevel < LIGHT_MIN || currentLightLevel > LIGHT_MAX);

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224 });
  const result = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks(true); // true = use tiny landmark net

  // face-api's detectSingleFace only returns one face; for "multiple faces"
  // we still need a count, so do a lightweight detectAllFaces pass too.
  const allDetections = await faceapi.detectAllFaces(video, options);

  const now = Date.now();
  let gazeAway = false;

  // ----- No face -----
  if (allDetections.length === 0) {
    // Don't penalize the user for bad lighting hiding their face — warn
    // locally instead of reporting a violation. This directly addresses
    // "bad lighting = false positives, embarrassing".
    if (lightBad) {
      noFaceStreak = 0;
      showFlag("Lighting too poor to detect face — adjust lighting");
    } else {
      noFaceStreak++;
      multiFaceStreak = 0;
      gazeAwayStreak = 0;
      if (noFaceStreak >= NO_FACE_STREAK_THRESHOLD && now - noFaceFlaggedAt > RE_FLAG_COOLDOWN_MS) {
        noFaceFlaggedAt = now;
        showFlag("No face detected");
        reportViolation("FACE_NO_FACE_VIOLATION", {
          reason: "No face detected in webcam for sustained period",
          light_level: currentLightLevel
        });
      }
    }
    drawDetection(null, false);
  }
  // ----- Multiple faces -----
  else if (allDetections.length > 1) {
    multiFaceStreak++;
    noFaceStreak = 0;
    gazeAwayStreak = 0;
    if (multiFaceStreak >= MULTI_FACE_STREAK_THRESHOLD && now - multiFaceFlaggedAt > RE_FLAG_COOLDOWN_MS) {
      multiFaceFlaggedAt = now;
      showFlag("Multiple faces detected");
      reportViolation("FACE_MULTIPLE_VIOLATION", {
        reason: "Multiple faces detected in webcam",
        face_count: allDetections.length
      });
    }
    drawDetection(null, false);
  }
  // ----- Exactly one face: run gaze check -----
  else {
    noFaceStreak = 0;
    multiFaceStreak = 0;

    if (result && result.landmarks) {
      const gaze = estimateGazeAway(result.landmarks);
      gazeAway = gaze.away;

      if (gazeAway && !lightBad) {
        gazeAwayStreak++;
        if (gazeAwayStreak >= GAZE_STREAK_THRESHOLD && now - gazeFlaggedAt > RE_FLAG_COOLDOWN_MS) {
          gazeFlaggedAt = now;
          showFlag("Looking away from screen");
          reportViolation("GAZE_VIOLATION", {
            reason: "Sustained gaze/head turn away from screen",
            horizontal_ratio: gaze.horizontalRatio,
            vertical_ratio: gaze.verticalRatio
          });
        }
      } else {
        gazeAwayStreak = 0;
        if (!lightBad) clearFlag();
      }
      drawDetection(result, gazeAway);
    } else {
      drawDetection(null, false);
    }

    if (lightBad) showFlag("Lighting too poor — adjust lighting");
  }

  // ----- Perf sample -----
  const frameMs = performance.now() - frameStart;
  perf.frameTimes.push(frameMs);
  if (perf.frameTimes.length > perf.maxSamples) perf.frameTimes.shift();
  if (perfStatsEl) {
    const avg = perf.frameTimes.reduce((a, b) => a + b, 0) / perf.frameTimes.length;
    perfStatsEl.textContent = `detect loop: ${frameMs.toFixed(0)}ms (avg ${avg.toFixed(0)}ms over ${perf.frameTimes.length} frames)`;
  }

  setTimeout(detectLoop, DETECT_INTERVAL_MS);
}

// ===== Flow control =====
beginBtn.addEventListener("click", () => {
  monitoring = true;
  calibrationScreen.style.display = "none";
  monitorScreen.style.display = "flex";
  setStatus("Monitoring active", "ok");
  detectLoop();
});

(async function init() {
  try {
    await loadModels();
    await startCamera();
    setStatus("Calibrating lighting…", "ok");
    runCalibrationLoop();
  } catch (err) {
    // status already set by whichever step failed
  }
})();