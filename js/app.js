// Central singletons. Kept dependency-free to avoid circular imports.
export const app = {
  engine: null,
  world: null,
  library: null,
  history: null,
  ui: null,
  photo: null,
  project: null,
  settings: null,
  selection: null,       // record id (string) | null
  selectedMaterial: 0,    // material index within the selected object
  activePanel: 'tools',
  photoMode: false,
  busy: false,
  started: false,
  booted: false,
  flags: {
    pointerDownOnCanvas: false,
    gizmoDragging: false,
    draggingAsset: null,
    suppressAutoSave: false,
  },
};

export const DEFAULT_SETTINGS = {
  version: 1,
  quality: 'auto',          // auto | ultra | high | medium | low
  dynamicResolution: true,
  shadows: true,
  post: true,
  bloom: true,
  dof: false,
  dofFocus: 8,
  dofAperture: 0.0022,
  autoSave: true,
  smartTextures: true,
  smartAggression: 'balanced', // conservative | balanced | eager
  autoScale: true,
  autoPlayAnimations: true,
  haptics: true,
  showGrid: true,
  showPerf: true,
  gizmoSnap: false,
  gizmoSpace: 'world',
  lockGround: true,
  units: 'm',
  cameraSpeed: 1,
  onboardingDone: false,
  homeSeen: false,
  lastWorld: null,
  photoWatermark: false,
};

export const QUALITY = {
  ultra: { dpr: 2, shadow: 4096, msaa: 4, transmission: 1.0, label: 'Ultra' },
  high: { dpr: 2, shadow: 2048, msaa: 4, transmission: 0.8, label: 'High' },
  medium: { dpr: 1.5, shadow: 1024, msaa: 0, transmission: 0.5, label: 'Balanced' },
  low: { dpr: 1.0, shadow: 512, msaa: 0, transmission: 0.35, label: 'Fast' },
};

export function isIPad() {
  return /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

export function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
}
