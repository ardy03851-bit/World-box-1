import { materialStateFromPreset } from './core/materials.js';
import { mulberry32 } from './core/util.js';

const deepMerge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
};

export function makeEnv(overrides = {}) {
  const base = {
    mode: 'studio',
    tone: 'aces',
    exposure: 1.05,
    envIntensity: 1,
    background: { type: 'color', color: '#0b0b0f' },
    sky: { turbidity: 3.4, rayleigh: 1.15, mieCoefficient: 0.0045, mieDirectionalG: 0.82, sunElevation: 16, sunAzimuth: 190 },
    sun: { color: '#fff2e0', intensity: 3.0, shadows: true, shadowExtent: 55 },
    hemi: { sky: '#ccd7ff', ground: '#3a3228', intensity: 0.5 },
    fog: { enabled: false, color: '#aab0b8', density: 0.01 },
    ground: { enabled: true, color: '#17171b', roughness: 0.9, metalness: 0.0, size: 280, segments: 96 },
    lights: [],
    post: {
      enabled: true,
      bloom: true,
      bloomStrength: 0.26,
      bloomRadius: 0.52,
      bloomThreshold: 1.02,
      dof: { enabled: false, focus: 8, aperture: 0.002, maxblur: 0.01 },
    },
    grade: { contrast: 0.05, saturation: 0, temperature: 0, tint: 0, vignette: 0.3, grain: 0.025, chroma: 0, letterbox: 0, highlightTint: [1, 1, 1], shadowTint: [0, 0, 0] },
  };
  return deepMerge(base, overrides);
}

const mat = (preset, extra = {}) => materialStateFromPreset(preset, extra);

let _oid = 0;
const obj = (o = {}) => ({
  id: `o_${(++_oid).toString(36)}`,
  name: 'Object',
  kind: 'primitive',
  visible: true,
  locked: false,
  castShadow: true,
  receiveShadow: true,
  transform: { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] },
  ...o,
});

const rock = (name, p, s, color = '#2f2b26', rot = null, detail = 1) =>
  obj({
    name,
    kind: 'primitive',
    primitive: { type: 'icosahedron', params: { radius: 1, detail } },
    material: mat('clay', { color, roughness: 0.93, metalness: 0, flatShading: true, envMapIntensity: 0.55 }),
    transform: { p, r: rot || [0.4, 0.9, 0.2], s },
    castShadow: true,
  });

function scatterRocks(seed, count, { radius = 16, color = '#2f2b26', min = 0.3, max = 1.3, y = 0, detail = 1 } = {}) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = min + rnd() * (max - min);
    out.push({
      ...rock(`Rock ${i + 1}`, [x, y + 0.1, z], [s * (0.9 + rnd() * 0.6), s * (0.65 + rnd() * 0.5), s * (0.9 + rnd() * 0.6)], color, [rnd() * 3, rnd() * 6, rnd() * 3], detail),
      settle: true,
    });
  }
  return out;
}

// ── Noir Canyon ───────────────────────────────────────────────
const noirCanyon = {
  id: 'noir',
  name: 'Noir Canyon',
  tagline: 'A desert carved by monochrome light.',
  meta: 'PROCEDURAL · 24 OBJECTS',
  palette: ['#e6e4e0', '#a9a7a3', '#5a5752', '#232120'],
  env: makeEnv({
    mode: 'outdoor',
    exposure: 1.22,
    envIntensity: 0.98,
    background: { type: 'gradient', top: '#111419', bottom: '#4a4f58' },
    sky: { turbidity: 5.2, rayleigh: 0.5, mieCoefficient: 0.006, mieDirectionalG: 0.86, sunElevation: 17, sunAzimuth: 214 },
    sun: { color: '#ffe9cf', intensity: 3.2, shadowExtent: 78 },
    hemi: { sky: '#8b96a8', ground: '#3a322a', intensity: 0.78 },
    fog: { enabled: true, color: '#3a3f47', density: 0.0058 },
    ground: { color: '#3a342d', roughness: 0.97, metalness: 0.0, size: 420 },
    lights: [
      { id: 'moon_fill', type: 'directional', color: '#b7c8e4', intensity: 0.85, position: [-18, 14, -16] },
      { id: 'front_fill', type: 'directional', color: '#e3e6ec', intensity: 0.9, position: [16, 9, 20] },
    ],
    post: { bloomStrength: 0.22, bloomRadius: 0.5, bloomThreshold: 1.05 },
    grade: { saturation: -0.95, contrast: 0.19, temperature: -0.03, vignette: 0.34, grain: 0.05, chroma: 0.18 },
  }),
  camera: { position: [17.5, 10.5, 24], target: [0, 1.2, 0], fov: 36 },
  build() {
    return [
      obj({
        name: 'Canyon floor',
        kind: 'terrain',
        terrain: { size: 170, resolution: 180, amp: 3.0, freq: 0.85, octaves: 5, seed: 19, ridged: false },
        material: mat('clay', { color: '#544c42', roughness: 0.96, metalness: 0.0, envMapIntensity: 0.8 }),
      }),
      ...scatterRocks(11, 14, { radius: 24, color: '#4a423a', min: 0.25, max: 1.15 }),
      ...scatterRocks(77, 5, { radius: 9, color: '#3c352e', min: 0.8, max: 1.8, detail: 1 }),
      obj({
        name: 'Still sphere',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 1.45, widthSegments: 96, heightSegments: 64 } },
        material: mat('chrome', { color: '#dcdcd8', roughness: 0.24, metalness: 0.9, envMapIntensity: 0.85 }),
        transform: { p: [0, 2.3, 0], r: [0, 0, 0], s: [1, 1, 1] },
        settle: true,
        settleOffset: 0.15,
      }),
      obj({
        name: 'West monolith',
        kind: 'primitive',
        primitive: { type: 'shard', params: { radius: 1.15, height: 7.5, sides: 4 } },
        material: mat('obsidian', { color: '#131211', roughness: 0.22, metalness: 0.15 }),
        transform: { p: [-8.5, 0, -7], r: [0, 0.6, 0.02], s: [1, 1, 1] },
        settle: true,
      }),
      obj({
        name: 'East monolith',
        kind: 'primitive',
        primitive: { type: 'shard', params: { radius: 0.9, height: 4.6, sides: 5 } },
        material: mat('obsidian', { color: '#181715', roughness: 0.3, metalness: 0.1 }),
        transform: { p: [7.5, 0, -9], r: [0, -0.8, -0.03], s: [1, 1, 1] },
        settle: true,
      }),
      obj({
        name: 'Black ring',
        kind: 'primitive',
        primitive: { type: 'torus', params: { radius: 2.2, tube: 0.08, radialSegments: 32, tubularSegments: 200 } },
        material: mat('chrome', { color: '#0e0e10', metalness: 0.8, roughness: 0.18, envMapIntensity: 1.2 }),
        transform: { p: [0.4, 3.6, -0.2], r: [1.45, 0.2, 0.3], s: [1, 1, 1] },
      }),
    ];
  },
};

// ── Dune Sea ──────────────────────────────────────────────────
const duneSea = {
  id: 'dune',
  name: 'Dune Sea',
  tagline: 'Warm wind, long shadows, endless sand.',
  meta: 'PROCEDURAL · 12 OBJECTS',
  palette: ['#f5d7a4', '#d6a468', '#9a6a3e', '#3c2716'],
  env: makeEnv({
    mode: 'outdoor',
    exposure: 0.98,
    envIntensity: 0.8,
    background: { type: 'gradient', top: '#101a30', bottom: '#bd7c42' },
    sky: { turbidity: 4.0, rayleigh: 1.0, mieCoefficient: 0.005, mieDirectionalG: 0.86, sunElevation: 9, sunAzimuth: 254 },
    sun: { color: '#ffc98c', intensity: 2.6, shadowExtent: 80 },
    hemi: { sky: '#93a8d4', ground: '#8a5c34', intensity: 0.42 },
    fog: { enabled: true, color: '#a8743f', density: 0.0046 },
    ground: { color: '#a97e4e', roughness: 0.94, metalness: 0, size: 470 },
    post: { bloomStrength: 0.22, bloomRadius: 0.55, bloomThreshold: 1.05 },
    grade: { saturation: 0.02, contrast: 0.14, temperature: 0.16, tint: 0.01, vignette: 0.42, grain: 0.035, chroma: 0.08 },
  }),
  camera: { position: [15, 8, 20], target: [0, 1.5, 0], fov: 36 },
  build() {
    return [
      obj({
        name: 'Dune field',
        kind: 'terrain',
        terrain: { size: 180, resolution: 190, amp: 4.2, freq: 1.1, octaves: 4, seed: 42, ridged: false },
        material: mat('clay', { color: '#b08a5c', roughness: 0.94, metalness: 0, envMapIntensity: 0.6 }),
      }),
      ...scatterRocks(31, 8, { radius: 26, color: '#8a6743', min: 0.18, max: 0.6 }),
      obj({
        name: 'Sun stone',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 1.7, widthSegments: 96, heightSegments: 64 } },
        material: mat('gold', { color: '#ffd9a0', metalness: 1, roughness: 0.22 }),
        transform: { p: [-2.2, 2.6, 0.6], r: [0, 0, 0], s: [1, 1, 1] },
        settle: true,
        settleOffset: 2.1,
      }),
      obj({
        name: 'Arch A',
        kind: 'primitive',
        primitive: { type: 'torus', params: { radius: 2.6, tube: 0.34, radialSegments: 40, tubularSegments: 160 } },
        material: mat('clay', { color: '#b1865a', roughness: 0.88 }),
        transform: { p: [7.5, 1.8, -6], r: [0, 0.7, 0], s: [1, 1, 0.55] },
        settle: true,
        settleOffset: 1.2,
      }),
      obj({
        name: 'Arch B',
        kind: 'primitive',
        primitive: { type: 'torus', params: { radius: 1.6, tube: 0.22, radialSegments: 32, tubularSegments: 120 } },
        material: mat('clay', { color: '#a67a4e', roughness: 0.9 }),
        transform: { p: [-9, 1.1, -10], r: [0, -0.4, 0], s: [1, 1, 0.4] },
        settle: true,
        settleOffset: 0.8,
      }),
    ];
  },
};

// ── Glass Garden ──────────────────────────────────────────────
const glassGarden = {
  id: 'garden',
  name: 'Glass Garden',
  tagline: 'Light, glass and quiet symmetry.',
  meta: 'STUDIO · 6 OBJECTS',
  palette: ['#f7f3ec', '#d9e2e6', '#a9c0c8', '#6d848e'],
  env: makeEnv({
    mode: 'studio',
    exposure: 1.02,
    envIntensity: 0.8,
    background: { type: 'gradient', top: '#060c0d', bottom: '#213833' },
    sun: { color: '#e8fff6', intensity: 1.8, shadowExtent: 30 },
    hemi: { sky: '#8fb9b0', ground: '#0a0f10', intensity: 0.38 },
    fog: { enabled: true, color: '#16241f', density: 0.011 },
    ground: { color: '#0d1516', roughness: 0.34, metalness: 0.22, size: 280 },
    post: { bloomStrength: 0.24, bloomRadius: 0.55, bloomThreshold: 1.05 },
    grade: { saturation: -0.04, contrast: 0.18, temperature: -0.02, vignette: 0.46, grain: 0.028, chroma: 0.08 },
    lights: [
      { id: 'garden_rim', type: 'spot', color: '#a8ffe2', intensity: 16, position: [-5, 7, -4], angle: 55, penumbra: 0.9, target: [0, 0.5, 0] },
      { id: 'garden_warm', type: 'point', color: '#ffb877', intensity: 3.2, position: [3.2, 1.4, 3.0], distance: 10, decay: 2 },
    ],
  }),
  camera: { position: [8, 4.6, 11.4], target: [0, 1.3, 0], fov: 38 },
  build() {
    return [
      obj({
        name: 'Glass orb',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 1.55, widthSegments: 96, heightSegments: 64 } },
        material: mat('glass', { color: '#ffffff', roughness: 0.02, thickness: 1.1, ior: 1.52 }),
        transform: { p: [0, 1.58, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Frosted orb',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 0.95, widthSegments: 72, heightSegments: 48 } },
        material: mat('frosted', { color: '#f2f7f8', roughness: 0.38 }),
        transform: { p: [-2.5, 0.98, 1.1], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Chrome ring',
        kind: 'primitive',
        primitive: { type: 'torus', params: { radius: 1.5, tube: 0.055, radialSegments: 32, tubularSegments: 200 } },
        material: mat('chrome', { color: '#f4f4f6', roughness: 0.04, metalness: 1 }),
        transform: { p: [2.1, 2.3, -0.6], r: [1.35, 0.4, 0.2], s: [1, 1, 1] },
      }),
      obj({
        name: 'Ceramic capsule',
        kind: 'primitive',
        primitive: { type: 'capsule', params: { radius: 0.42, height: 1.5, radialSegments: 48, capSegments: 20 } },
        material: mat('ceramic', { color: '#f7f4ec' }),
        transform: { p: [2.5, 0.76, 1.8], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Amber sphere',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 0.62, widthSegments: 64, heightSegments: 48 } },
        material: mat('wax', { color: '#f4c69f', roughness: 0.3, transmission: 0.7 }),
        transform: { p: [-1.4, 0.66, 2.6], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Dark disc',
        kind: 'primitive',
        primitive: { type: 'cylinder', params: { radiusTop: 2.4, radiusBottom: 2.4, height: 0.12, segments: 96 } },
        material: mat('obsidian', { color: '#1b1c1e', roughness: 0.35, metalness: 0.2 }),
        transform: { p: [0, 0.06, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }),
    ];
  },
};

// ── Studio Mill ───────────────────────────────────────────────
const studioMill = {
  id: 'studio',
  name: 'Studio Mill',
  tagline: 'Editorial product light, endless paper.',
  meta: 'STUDIO · 4 OBJECTS',
  palette: ['#f3f1ec', '#d8d5ce', '#a9a49a', '#56524b'],
  env: makeEnv({
    mode: 'studio',
    exposure: 1.0,
    envIntensity: 0.82,
    background: { type: 'gradient', top: '#17171b', bottom: '#070708' },
    sun: { color: '#fff1e2', intensity: 2.4, shadowExtent: 24 },
    hemi: { sky: '#b9c4d8', ground: '#141312', intensity: 0.42 },
    fog: { enabled: true, color: '#0b0b0d', density: 0.007 },
    ground: { color: '#17171a', roughness: 0.52, metalness: 0.08, size: 90 },
    post: { bloomStrength: 0.2, bloomRadius: 0.5, bloomThreshold: 1.05 },
    grade: { saturation: -0.02, contrast: 0.16, temperature: 0.01, vignette: 0.44, grain: 0.02, chroma: 0.02 },
  }),
  camera: { position: [5.6, 3.2, 7.4], target: [0, 1.15, 0], fov: 36 },
  build() {
    return [
      obj({
        name: 'Chrome knot',
        kind: 'primitive',
        primitive: { type: 'torusKnot', params: { radius: 0.9, tube: 0.25, tubularSegments: 240, radialSegments: 48, p: 2, q: 3 } },
        material: mat('chrome', { color: '#f4f5f7', metalness: 1, roughness: 0.035 }),
        transform: { p: [0, 1.55, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Plaster sphere',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 0.78, widthSegments: 80, heightSegments: 56 } },
        material: mat('ceramic', { color: '#f6f2e9', roughness: 0.55, clearcoat: 0 }),
        transform: { p: [-1.9, 0.79, 0.7], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Clay plinth',
        kind: 'primitive',
        primitive: { type: 'cylinder', params: { radiusTop: 0.85, radiusBottom: 0.95, height: 0.9, segments: 72 } },
        material: mat('clay', { color: '#cbb9a4', roughness: 0.88 }),
        transform: { p: [2.1, 0.45, -1.1], r: [0, 0.4, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Amber glass ball',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 0.46, widthSegments: 64, heightSegments: 48 } },
        material: mat('glass', { color: '#ffcf9b', roughness: 0.02, thickness: 0.6, ior: 1.5 }),
        transform: { p: [2.1, 1.38, -1.1], r: [0, 0, 0], s: [1, 1, 1] },
      }),
    ];
  },
};

// ── Midnight Atrium ───────────────────────────────────────────
const midnightAtrium = {
  id: 'atrium',
  name: 'Midnight Atrium',
  tagline: 'Neon, wet stone and quiet electricity.',
  meta: 'STUDIO · 6 OBJECTS',
  palette: ['#9be7ff', '#5578ff', '#2a1f45', '#08070c'],
  env: makeEnv({
    mode: 'studio',
    exposure: 1.0,
    envIntensity: 0.65,
    background: { type: 'gradient', top: '#05050a', bottom: '#0b0c16' },
    sun: { color: '#93b4ff', intensity: 0.4, shadows: true, shadowExtent: 30 },
    hemi: { sky: '#25304f', ground: '#08080c', intensity: 0.28 },
    fog: { enabled: true, color: '#060812', density: 0.014 },
    ground: { color: '#090a0f', roughness: 0.16, metalness: 0.6, size: 120 },
    post: { bloomStrength: 0.32, bloomRadius: 0.6, bloomThreshold: 1.12 },
    grade: { saturation: 0.05, contrast: 0.22, temperature: -0.1, vignette: 0.54, grain: 0.04, chroma: 0.2 },
    lights: [
      { id: 'cyan_rim', type: 'point', color: '#54e0ff', intensity: 14, position: [-3.2, 2.6, -2.2], distance: 14, decay: 2 },
      { id: 'magenta_rim', type: 'point', color: '#ff4f9a', intensity: 10, position: [3.4, 1.9, 2.4], distance: 12, decay: 2 },
      { id: 'top_key', type: 'spot', color: '#dfe9ff', intensity: 12, position: [0, 8, 2], angle: 42, penumbra: 0.8, target: [0, 0, 0] },
    ],
  }),
  camera: { position: [6.6, 3.7, 8.4], target: [0, 1.25, 0], fov: 40 },
  build() {
    return [
      obj({
        name: 'Neon ring',
        kind: 'primitive',
        primitive: { type: 'torus', params: { radius: 2.0, tube: 0.05, radialSegments: 32, tubularSegments: 220 } },
        material: mat('neon', { color: '#0a0a10', emissive: '#6df0ff', emissiveIntensity: 3.2 }),
        transform: { p: [0, 2.5, -1.2], r: [1.25, 0.15, 0.4], s: [1, 1, 1] },
      }),
      obj({
        name: 'Obsidian slab',
        kind: 'primitive',
        primitive: { type: 'shard', params: { radius: 0.95, height: 4.2, sides: 4 } },
        material: mat('obsidian', { color: '#0a0a0e', roughness: 0.1, metalness: 0.4 }),
        transform: { p: [-1.6, 0, -2.6], r: [0, 0.3, 0.04], s: [1, 1, 1] },
      }),
      obj({
        name: 'Smoked glass orb',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 1.15, widthSegments: 96, heightSegments: 64 } },
        material: mat('glass', { color: '#cfd8ff', roughness: 0.06, thickness: 1.4, ior: 1.46, envMapIntensity: 1.6 }),
        transform: { p: [1.8, 1.2, 0.6], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Holo band',
        kind: 'primitive',
        primitive: { type: 'torus', params: { radius: 1.35, tube: 0.12, radialSegments: 32, tubularSegments: 160 } },
        material: mat('hologram', { emissive: '#0f4f66', emissiveIntensity: 1.6 }),
        transform: { p: [1.8, 1.2, 0.6], r: [1.7, 0.4, 0.2], s: [1, 1, 1] },
      }),
      obj({
        name: 'Glass shard',
        kind: 'primitive',
        primitive: { type: 'shard', params: { radius: 0.42, height: 1.9, sides: 3 } },
        material: mat('glass', { color: '#ff9ec4', roughness: 0.05, thickness: 0.5 }),
        transform: { p: [3.4, 0, 2.4], r: [0.08, 0.9, -0.06], s: [1, 1, 1] },
      }),
      obj({
        name: 'Dust floor reflector',
        kind: 'primitive',
        primitive: { type: 'cylinder', params: { radiusTop: 4.4, radiusBottom: 4.4, height: 0.06, segments: 96 } },
        material: mat('obsidian', { color: '#0c0d13', roughness: 0.08, metalness: 0.7 }),
        transform: { p: [0, 0.03, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }),
    ];
  },
};

export const PRESETS = [noirCanyon, duneSea, glassGarden, studioMill, midnightAtrium];

export const EMPTY_WORLD = {
  id: 'blank',
  name: 'Blank Studio',
  tagline: 'Somewhere new.',
  env: makeEnv({
    mode: 'studio',
    exposure: 1.08,
    background: { type: 'gradient', top: '#232630', bottom: '#0c0d12' },
    ground: { color: '#17181d', roughness: 0.55, metalness: 0.2, size: 200 },
    hemi: { sky: '#9fb3d9', ground: '#1b1a1f', intensity: 0.8 },
    sun: { color: '#fff2df', intensity: 3.2, shadowExtent: 35 },
    fog: { enabled: true, color: '#12141a', density: 0.012 },
    post: { bloomStrength: 0.3 },
    grade: { contrast: 0.06, saturation: 0, vignette: 0.3, grain: 0.02 },
  }),
  camera: { position: [6, 3.6, 7.5], target: [0, 1, 0], fov: 42 },
  build() {
    return [
      obj({
        name: 'Pedestal',
        kind: 'primitive',
        primitive: { type: 'cylinder', params: { radiusTop: 1.6, radiusBottom: 1.8, height: 0.5, segments: 96 } },
        material: mat('ceramic', { color: '#e8e4dc' }),
        transform: { p: [0, 0.25, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }),
      obj({
        name: 'Welcome sphere',
        kind: 'primitive',
        primitive: { type: 'sphere', params: { radius: 0.85, widthSegments: 96, heightSegments: 64 } },
        material: mat('glass', { color: '#ffffff', roughness: 0.03, thickness: 0.8 }),
        transform: { p: [0, 1.4, 0], r: [0, 0, 0], s: [1, 1, 1] },
      }),
    ];
  },
};

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

export function buildPresetProject(preset) {
  return {
    version: 2,
    name: preset.name,
    presetId: preset.id,
    environment: structuredClone(preset.env),
    objects: preset.build ? preset.build().map((o) => structuredClone(o)) : [],
    camera: JSON.parse(JSON.stringify(preset.camera || { position: [6, 3.6, 7.5], target: [0, 1, 0], fov: 42 })),
    settings: {},
  };
}

export function newEmptyProject() {
  return buildPresetProject(EMPTY_WORLD);
}
