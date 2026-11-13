// Small shared helpers — no dependencies.

let _uid = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(_uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const round = (v, p = 2) => {
  const f = Math.pow(10, p);
  return Math.round(v * f) / f;
};
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export function debounce(fn, ms = 180) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
}

export function throttle(fn, ms = 60) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return (...args) => {
    const now = performance.now();
    lastArgs = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = performance.now();
        fn(...lastArgs);
      }, ms - (now - last));
    }
  };
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function download(blobOrUrl, filename) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(obj));
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fileExt(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function baseName(path = '') {
  return String(path).split(/[\\/]/).pop() || '';
}

export function stripExt(name = '') {
  return String(name).replace(/\.[a-z0-9]+$/i, '');
}

export function normalizeName(name = '') {
  return stripExt(baseName(name)).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function titleCase(str = '') {
  return String(str)
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function prettyName(fileName = '') {
  let n = stripExt(baseName(fileName))
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // tidy up common 3d-pack suffixes
  n = n.replace(/\b(final|low|high|lowpoly|highpoly|pbr|game ?ready)\b/gi, '').replace(/\s+/g, ' ').trim();
  return titleCase(n || baseName(fileName) || 'Asset');
}

// ── seeded random / noise ────────────────────────────────────
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function makeNoise2D(seed = 1337) {
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smoothstep(x - xi);
    const yf = smoothstep(y - yi);
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed);
    const d = hash2(xi + 1, yi + 1, seed);
    return lerp(lerp(a, b, xf), lerp(c, d, xf), yf) * 2 - 1;
  };
}

export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return (sum / norm) * 0.5 + 0.5;
}

export function ridged(noise, x, y, octaves = 4) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Raycast a ray against a set of objects with a small screen-space tolerance.
 * Used for tap selection on touch devices.
 */
export function isTouch() {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

export function vibrate(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

export function setVar(el, name, value) {
  el?.style.setProperty(name, value);
}

export function clampText(str, n = 28) {
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

export function downloadName(base, ext) {
  const safe = String(base || 'worldbox').replace(/[^\w\d\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'worldbox';
  return `${safe}.${ext}`;
}
