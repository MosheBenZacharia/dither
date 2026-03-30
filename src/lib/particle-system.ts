export interface Shockwave {
  x: number;
  y: number;
  start: number;
}

export interface DotSystem {
  count: number;
  baseX: Float32Array;
  baseY: Float32Array;
  dx: Float32Array;
  dy: Float32Array;
  brightness: Float32Array;
  tint: Float32Array;
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  size: number;
}

const SHOCKWAVE_SPEED = 225;
const SHOCKWAVE_WIDTH = 37;
const SHOCKWAVE_STRENGTH = 20;
const SHOCKWAVE_DURATION = 675;
const MOUSE_RADIUS = 100;
const MOUSE_RADIUS_SQ = MOUSE_RADIUS * MOUSE_RADIUS;
const MOUSE_FORCE_PEAK = 40;
const EASING = 0.12;
const SNAP_THRESHOLD = 0.01;

export function createDotSystem(
  points: Float32Array,
  scaleFactor: number,
  dotScale: number,
  offsetX: number,
  offsetY: number,
  colors?: Uint8Array,
  gridW?: number
): DotSystem {
  const count = points.length / 2;
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const dx = new Float32Array(count);
  const dy = new Float32Array(count);
  const brightness = new Float32Array(count);
  const tint = new Float32Array(count);
  const r = new Uint8Array(count);
  const g = new Uint8Array(count);
  const b = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    baseX[i] = offsetX + points[i * 2] * scaleFactor;
    baseY[i] = offsetY + points[i * 2 + 1] * scaleFactor;
    brightness[i] = 1;
    tint[i] = 1;
    if (colors && gridW) {
      const px = Math.round(points[i * 2]);
      const py = Math.round(points[i * 2 + 1]);
      const ci = (py * gridW + px) * 3;
      r[i] = colors[ci];
      g[i] = colors[ci + 1];
      b[i] = colors[ci + 2];
    } else {
      r[i] = 138; g[i] = 143; b[i] = 152;
    }
  }

  return { count, baseX, baseY, dx, dy, brightness, tint, r, g, b, size: scaleFactor * dotScale };
}

export function updateDots(
  sys: DotSystem,
  mouseX: number,
  mouseY: number,
  mouseActive: boolean,
  shockwaves: Shockwave[],
  now: number
): boolean {
  const { count, baseX, baseY, dx, dy } = sys;

  let numActive = shockwaves.length;
  for (let k = shockwaves.length - 1; k >= 0; k--) {
    if (now - shockwaves[k].start >= SHOCKWAVE_DURATION) {
      shockwaves.splice(k, 1);
      numActive--;
    }
  }

  const shockMultiplier = numActive > 0 ? 1 + 0.5 * (numActive - 1) : 0;
  let hasMotion = false;

  for (let i = 0; i < count; i++) {
    let targetFx = 0;
    let targetFy = 0;

    if (mouseActive) {
      const vx = (baseX[i] + dx[i]) - mouseX;
      const vy = (baseY[i] + dy[i]) - mouseY;
      const dist2 = vx * vx + vy * vy;

      if (dist2 > 0.1 && dist2 < MOUSE_RADIUS_SQ) {
        const dist = Math.sqrt(dist2);
        const falloff = 1 - dist / MOUSE_RADIUS;
        const force = falloff * falloff * falloff * MOUSE_FORCE_PEAK;
        targetFx += (vx / dist) * force;
        targetFy += (vy / dist) * force;
      }
    }

    for (let k = 0; k < shockwaves.length; k++) {
      const sw = shockwaves[k];
      const elapsed = now - sw.start;
      const radius = (elapsed / 1000) * SHOCKWAVE_SPEED;
      const life = 1 - elapsed / SHOCKWAVE_DURATION;

      const sx = baseX[i] - sw.x;
      const sy = baseY[i] - sw.y;
      const dist = Math.sqrt(sx * sx + sy * sy);

      if (dist >= 0.1) {
        const band = Math.abs(dist - radius);
        if (band < SHOCKWAVE_WIDTH) {
          const waveForce =
            (1 - band / SHOCKWAVE_WIDTH) *
            life *
            SHOCKWAVE_STRENGTH *
            shockMultiplier;
          targetFx += (sx / dist) * waveForce;
          targetFy += (sy / dist) * waveForce;
        }
      }
    }

    dx[i] += (targetFx - dx[i]) * EASING;
    dy[i] += (targetFy - dy[i]) * EASING;

    if (Math.abs(dx[i]) < SNAP_THRESHOLD) dx[i] = 0;
    if (Math.abs(dy[i]) < SNAP_THRESHOLD) dy[i] = 0;

    if (dx[i] !== 0 || dy[i] !== 0) hasMotion = true;
  }

  return hasMotion || shockwaves.length > 0 || mouseActive;
}

export function renderDots(
  ctx: CanvasRenderingContext2D,
  sys: DotSystem,
  invert: boolean,
  canvasW: number,
  canvasH: number,
  dpr: number,
  colorMode = false
): void {
  ctx.clearRect(0, 0, canvasW * dpr, canvasH * dpr);

  const size = sys.size * dpr;
  const pad = 0.25 * dpr;
  const padSize = 0.5 * dpr;

  if (colorMode) {
    // Group particles by quantized color + alpha bucket to minimize fillStyle changes
    const colorBuckets = new Map<number, number[]>();
    for (let i = 0; i < sys.count; i++) {
      const alphaBucket = Math.min(20, Math.round(sys.brightness[i] * 20));
      // 5 bits per channel + 5 bits alpha = 20 bits total
      const key = (sys.r[i] >> 3) | ((sys.g[i] >> 3) << 5) | ((sys.b[i] >> 3) << 10) | (alphaBucket << 15);
      let bucket = colorBuckets.get(key);
      if (!bucket) { bucket = []; colorBuckets.set(key, bucket); }
      bucket.push(i);
    }
    for (const [key, ids] of colorBuckets) {
      const cr = (key & 0x1f) << 3;
      const cg = ((key >> 5) & 0x1f) << 3;
      const cb = ((key >> 10) & 0x1f) << 3;
      const alpha = ((key >> 15) & 0x1f) / 20;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      for (let j = 0; j < ids.length; j++) {
        const i = ids[j];
        const rx = (sys.baseX[i] + sys.dx[i]) * dpr;
        const ry = (sys.baseY[i] + sys.dy[i]) * dpr;
        ctx.fillRect(rx - pad, ry - pad, size + padSize, size + padSize);
      }
    }
  } else {
    const r = 30;
    const g = 30;
    const b = 30;

    const buckets: number[][] = new Array(126);
    for (let z = 0; z < 126; z++) buckets[z] = [];

    for (let i = 0; i < sys.count; i++) {
      const bucket = 6 * Math.round(20 * sys.brightness[i]) + Math.round(5 * sys.tint[i]);
      const clamped = Math.max(0, Math.min(125, bucket));
      buckets[clamped].push(i);
    }

    for (let z = 0; z < 126; z++) {
      const ids = buckets[z];
      if (ids.length === 0) continue;

      const alpha = Math.floor(z / 6) / 20;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;

      for (let j = 0; j < ids.length; j++) {
        const i = ids[j];
        const rx = (sys.baseX[i] + sys.dx[i]) * dpr;
        const ry = (sys.baseY[i] + sys.dy[i]) * dpr;
        ctx.fillRect(rx - pad, ry - pad, size + padSize, size + padSize);
      }
    }
  }
}
