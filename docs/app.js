const videoEl = document.getElementById("video");
const overlayEl = document.getElementById("overlay");
const startBtnEl = document.getElementById("startBtn");
const cameraStatusEl = document.getElementById("cameraStatus");
const edgeStatusEl = document.getElementById("edgeStatus");
const imuStatusEl = document.getElementById("imuStatus");
const orientationStatusEl = document.getElementById("orientationStatus");

const ctx = overlayEl.getContext("2d");
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

let stream;
let running = false;
let yawRad = 0;
let pitchRad = 0;
let rollRad = 0;
let gyro = { x: 0, y: 0, z: 0 };
let accel = { x: 0, y: 0, z: 0 };

function resize() {
  overlayEl.width = window.innerWidth;
  overlayEl.height = window.innerHeight;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rotate3D(point, rx, ry, rz) {
  let [x, y, z] = point;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const y1 = (y * cx) - (z * sx);
  const z1 = (y * sx) + (z * cx);
  y = y1;
  z = z1;

  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const x2 = (x * cy) + (z * sy);
  const z2 = (-x * sy) + (z * cy);
  x = x2;
  z = z2;

  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x3 = (x * cz) - (y * sz);
  const y3 = (x * sz) + (y * cz);
  return [x3, y3, z];
}

function projectPoint(point, width, height) {
  const [x, y, z] = point;
  const focal = width * 0.9;
  const depth = z + 3.2;
  const px = (x * focal) / depth + (width * 0.5);
  const py = (y * focal) / depth + (height * 0.5);
  return [px, py];
}

function drawCube(width, height) {
  const s = 0.42;
  const vertices = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const animatedYaw = yawRad + (performance.now() * 0.0002);
  const rotated = vertices.map((v) => rotate3D(v, pitchRad * 0.6, animatedYaw, rollRad * 0.7));
  const projected = rotated.map((v) => projectPoint(v, width, height));

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(96, 214, 255, 0.95)";
  ctx.shadowColor = "rgba(96, 214, 255, 0.65)";
  ctx.shadowBlur = 8;
  for (const [a, b] of edges) {
    const [x1, y1] = projected[a];
    const [x2, y2] = projected[b];
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawEdges(width, height) {
  const sw = 240;
  const sh = Math.round((height / width) * sw);
  sampleCanvas.width = sw;
  sampleCanvas.height = sh;
  sampleCtx.drawImage(videoEl, 0, 0, sw, sh);
  const img = sampleCtx.getImageData(0, 0, sw, sh);
  const data = img.data;
  ctx.fillStyle = "rgba(255, 240, 70, 0.9)";
  let hits = 0;
  const step = 2;
  for (let y = 1; y < sh - 1; y += step) {
    for (let x = 1; x < sw - 1; x += step) {
      const l = ((y * sw + (x - 1)) * 4);
      const r = ((y * sw + (x + 1)) * 4);
      const u = (((y - 1) * sw + x) * 4);
      const d = (((y + 1) * sw + x) * 4);
      const grayL = (data[l] + data[l + 1] + data[l + 2]) / 3;
      const grayR = (data[r] + data[r + 1] + data[r + 2]) / 3;
      const grayU = (data[u] + data[u + 1] + data[u + 2]) / 3;
      const grayD = (data[d] + data[d + 1] + data[d + 2]) / 3;
      const gx = grayR - grayL;
      const gy = grayD - grayU;
      const mag = Math.hypot(gx, gy);
      if (mag > 48) {
        const px = (x / sw) * width;
        const py = (y / sh) * height;
        ctx.fillRect(px, py, 2, 2);
        hits += 1;
      }
    }
  }
  edgeStatusEl.textContent = `edges: ${hits}`;
}

function render() {
  if (!running) return;
  const w = overlayEl.width;
  const h = overlayEl.height;
  ctx.clearRect(0, 0, w, h);
  if (videoEl.readyState >= 2) {
    drawEdges(w, h);
    drawCube(w, h);
  }
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
    imuStatusEl.textContent = `imu gyro[a,b,g]=${gyro.x.toFixed(1)}, ${gyro.y.toFixed(1)}, ${gyro.z.toFixed(1)} / acc=${accel.x.toFixed(1)}, ${accel.y.toFixed(1)}, ${accel.z.toFixed(1)}`;
  });

  window.addEventListener("deviceorientation", (event) => {
    const alpha = event.alpha ?? 0;
    const beta = event.beta ?? 0;
    const gamma = event.gamma ?? 0;
    yawRad = (alpha * Math.PI) / 180;
    pitchRad = clamp((beta * Math.PI) / 180, -1.2, 1.2);
    rollRad = clamp((gamma * Math.PI) / 180, -1.2, 1.2);
    orientationStatusEl.textContent = `orientation αβγ=${alpha.toFixed(1)}, ${beta.toFixed(1)}, ${gamma.toFixed(1)}`;
  });
}

async function start() {
  startBtnEl.disabled = true;
  try {
    await requestImuPermission();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
    bindImu();
    running = true;
    cameraStatusEl.textContent = "camera: active";
    render();
  } catch (error) {
    cameraStatusEl.textContent = `camera: failed (${error instanceof Error ? error.message : "unknown"})`;
    startBtnEl.disabled = false;
  }
}

window.addEventListener("resize", resize);
resize();
startBtnEl.addEventListener("click", start);
