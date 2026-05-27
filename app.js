import * as THREE from "https://unpkg.com/three@0.166.1/build/three.module.js";
import { estimatePose } from "./packages/core/dist/engine.js";

const VERSION = "v0.1.3-stabilized-demo";
const CONFIDENCE_GATE = 0.62;
const CONFIDENCE_HARD_REJECT = 0.45;
const POSITION_LERP_ALPHA = 0.18;
const ROTATION_SLERP_ALPHA = 0.22;
const MAX_STALE_FRAMES = 18;

const videoEl = document.getElementById("video");
const threeLayerEl = document.getElementById("threeLayer");
const overlayEl = document.getElementById("overlay");
const startBtnEl = document.getElementById("startBtn");
const versionEl = document.getElementById("version");
const cameraStatusEl = document.getElementById("cameraStatus");
const edgeStatusEl = document.getElementById("edgeStatus");
const imuStatusEl = document.getElementById("imuStatus");
const orientationStatusEl = document.getElementById("orientationStatus");
const poseStatusEl = document.getElementById("poseStatus");

if (versionEl) {
  versionEl.textContent = `Version: ${VERSION} / loaded: ${new Date().toLocaleString()}`;
}

const ctx = overlayEl.getContext("2d");
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

const shapeModel = {
  id: "demo-cross",
  type: "edge-graph",
  requiredTags: ["h-main", "v-main"],
  edges: [
    { a: [-1, 0, 0], b: [1, 0, 0], weight: 1.4, tag: "h-main" },
    { a: [0, -1, 0], b: [0, 1, 0], weight: 1.2, tag: "v-main" },
    { a: [-0.8, -0.8, 0], b: [0.8, 0.8, 0], weight: 0.4, tag: "diag-a" },
    { a: [-0.8, 0.8, 0], b: [0.8, -0.8, 0], weight: 0.4, tag: "diag-b" },
  ],
};

let stream;
let running = false;
let gyro = { x: 0, y: 0, z: 0 };
let accel = { x: 0, y: 0, z: 0 };
let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
let previousDetection;
let stableDetection;
let staleFrames = 0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100);
camera.position.set(0, 0, 0);
const renderer = new THREE.WebGLRenderer({
  canvas: threeLayerEl,
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.28, 0.28),
  new THREE.MeshNormalMaterial({ wireframe: false, transparent: true, opacity: 0.82 }),
);
scene.add(cube);
// Keep cube visible before first reliable pose lock.
cube.position.set(0, 0, -1.2);

const wire = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(0.29, 0.29, 0.29)),
  new THREE.LineBasicMaterial({ color: 0x4cd6ff }),
);
cube.add(wire);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  overlayEl.width = w;
  overlayEl.height = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function extractLines(width, height) {
  const sw = 256;
  const sh = Math.max(144, Math.round((height / width) * sw));
  sampleCanvas.width = sw;
  sampleCanvas.height = sh;
  sampleCtx.drawImage(videoEl, 0, 0, sw, sh);
  const { data } = sampleCtx.getImageData(0, 0, sw, sh);

  const lines = [];
  let edgeHits = 0;
  ctx.fillStyle = "rgba(255, 240, 70, 0.85)";

  for (let y = 2; y < sh - 2; y += 3) {
    let runStart = -1;
    for (let x = 2; x < sw - 2; x += 1) {
      const l = ((y * sw + (x - 1)) * 4);
      const r = ((y * sw + (x + 1)) * 4);
      const u = (((y - 1) * sw + x) * 4);
      const d = (((y + 1) * sw + x) * 4);
      const gx = ((data[r] + data[r + 1] + data[r + 2]) - (data[l] + data[l + 1] + data[l + 2])) / 3;
      const gy = ((data[d] + data[d + 1] + data[d + 2]) - (data[u] + data[u + 1] + data[u + 2])) / 3;
      const mag = Math.hypot(gx, gy);
      const on = mag > 52;
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        const runLen = x - runStart;
        if (runLen >= 16) {
          const x1 = (runStart / sw) * width;
          const x2 = (x / sw) * width;
          const yy = (y / sh) * height;
          lines.push({ x1, y1: yy, x2, y2: yy, score: Math.min(1, runLen / 72) });
          edgeHits += runLen;
        }
        runStart = -1;
      }
      if (on && x % 3 === 0) {
        const px = (x / sw) * width;
        const py = (y / sh) * height;
        ctx.fillRect(px, py, 2, 2);
      }
    }
  }

  edgeStatusEl.textContent = `edges: ${edgeHits}`;
  return lines;
}

function applyDetection(detection) {
  const [tx, ty, tz] = detection.pose.translation;
  const [qx, qy, qz, qw] = detection.pose.rotation;
  const targetPosition = new THREE.Vector3(tx, ty, -Math.max(0.5, tz));
  const targetQuaternion = new THREE.Quaternion(qx, qy, qz, qw);
  cube.position.lerp(targetPosition, POSITION_LERP_ALPHA);
  cube.quaternion.slerp(targetQuaternion, ROTATION_SLERP_ALPHA);
  poseStatusEl.textContent =
    `pose conf=${detection.confidence.toFixed(2)} t=(${tx.toFixed(2)}, ${ty.toFixed(2)}, ${tz.toFixed(2)})`;
}

function holdPoseStatus() {
  if (!stableDetection) {
    poseStatusEl.textContent = "pose: waiting";
    return;
  }
  const [tx, ty, tz] = stableDetection.pose.translation;
  poseStatusEl.textContent =
    `pose hold conf=${stableDetection.confidence.toFixed(2)} t=(${tx.toFixed(2)}, ${ty.toFixed(2)}, ${tz.toFixed(2)})`;
}

function render() {
  if (!running) return;
  const w = overlayEl.width;
  const h = overlayEl.height;
  ctx.clearRect(0, 0, w, h);

  if (videoEl.readyState >= 2) {
    const lines = extractLines(w, h);
    const detections = estimatePose({
      options: { shapeModel, need3D: true },
      frame: { timestamp: performance.now(), lines, keypoints: [], frameSize: { width: w, height: h } },
      previous: previousDetection,
    });
    const next = detections.length > 0 ? detections[0] : undefined;
    if (next && next.confidence >= CONFIDENCE_GATE) {
      previousDetection = next;
      stableDetection = next;
      staleFrames = 0;
      applyDetection(next);
    } else if (!stableDetection && next && next.confidence >= CONFIDENCE_HARD_REJECT) {
      // Bootstrap initial lock with a softer threshold.
      previousDetection = next;
      stableDetection = next;
      staleFrames = 0;
      applyDetection(next);
    } else if (next && next.confidence >= CONFIDENCE_HARD_REJECT) {
      staleFrames += 1;
      holdPoseStatus();
      if (staleFrames > MAX_STALE_FRAMES) {
        previousDetection = undefined;
      }
    } else {
      staleFrames += 1;
      holdPoseStatus();
      if (staleFrames > MAX_STALE_FRAMES) {
        previousDetection = undefined;
        stableDetection = undefined;
      }
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

async function requestImuPermission() {
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    const result = await DeviceMotionEvent.requestPermission();
    if (result !== "granted") throw new Error("DeviceMotion permission denied");
  }
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result !== "granted") throw new Error("DeviceOrientation permission denied");
  }
}

function bindImu() {
  window.addEventListener("devicemotion", (event) => {
    gyro = {
      x: event.rotationRate?.alpha ?? 0,
      y: event.rotationRate?.beta ?? 0,
      z: event.rotationRate?.gamma ?? 0,
    };
    accel = {
      x: event.accelerationIncludingGravity?.x ?? 0,
      y: event.accelerationIncludingGravity?.y ?? 0,
      z: event.accelerationIncludingGravity?.z ?? 0,
    };
    imuStatusEl.textContent =
      `imu gyro[a,b,g]=${gyro.x.toFixed(1)}, ${gyro.y.toFixed(1)}, ${gyro.z.toFixed(1)} / `
      + `acc=${accel.x.toFixed(1)}, ${accel.y.toFixed(1)}, ${accel.z.toFixed(1)}`;
  });

  window.addEventListener("deviceorientation", (event) => {
    latestOrientation = {
      alpha: event.alpha ?? 0,
      beta: event.beta ?? 0,
      gamma: event.gamma ?? 0,
    };
    orientationStatusEl.textContent =
      `orientation αβγ=${latestOrientation.alpha.toFixed(1)}, ${latestOrientation.beta.toFixed(1)}, ${latestOrientation.gamma.toFixed(1)}`;
  });
}

async function start() {
  startBtnEl.disabled = true;
  try {
    await requestImuPermission();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    bindImu();
    running = true;
    cameraStatusEl.textContent = "camera: active (core connected)";
    render();
  } catch (error) {
    cameraStatusEl.textContent = `camera: failed (${error instanceof Error ? error.message : "unknown"})`;
    startBtnEl.disabled = false;
  }
}

window.addEventListener("resize", resize);
resize();
startBtnEl.addEventListener("click", start);
