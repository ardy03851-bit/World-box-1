import * as THREE from 'three';
import { app } from '../app.js';
import { emit } from '../bus.js';
import { storage } from '../assets/storage.js';
import { uid, download, downloadName, clamp } from '../core/util.js';
import { $, $$, el, toast, openSheet, confirmDialog, haptic, clear } from './kit.js';

const state = {
  open: false,
  aspect: 'free',
  lens: 32,
  exposure: 0,
  resolution: 1,
  grid: false,
  focus: 8,
  film: 'Clean',
  photos: [],
  viewerId: null,
  viewerUrl: null,
  baseFov: 42,
  lastShot: null,
};

const FILMS = {
  Clean: { grade: { contrast: 0.05, saturation: 0, temperature: 0, tint: 0, vignette: 0.24, grain: 0.018, chroma: 0 }, tone: 'aces' },
  Noir: { grade: { contrast: 0.28, saturation: -1, temperature: -0.04, tint: 0, vignette: 0.46, grain: 0.075, chroma: 0.16 }, tone: 'aces' },
  Cinema: { grade: { contrast: 0.16, saturation: 0.06, temperature: 0.04, tint: 0.01, vignette: 0.36, grain: 0.05, chroma: 0.08 }, tone: 'agx' },
  Warm: { grade: { contrast: 0.1, saturation: 0.1, temperature: 0.22, tint: 0.02, vignette: 0.3, grain: 0.035, chroma: 0.04 }, tone: 'aces' },
  Ice: { grade: { contrast: 0.14, saturation: 0.02, temperature: -0.22, tint: -0.06, vignette: 0.34, grain: 0.035, chroma: 0.14 }, tone: 'aces' },
  Analog: { grade: { contrast: 0.08, saturation: -0.18, temperature: 0.08, tint: 0.03, vignette: 0.4, grain: 0.11, chroma: 0.26 }, tone: 'cineon' },
};

export function initPhoto() {
  app.photo = {
    open: openPhotoMode,
    close: closePhotoMode,
    openGallery,
    closeViewer,
    takeShot,
    state,
  };

  $('#photoBtn')?.addEventListener('click', openPhotoMode);
  $('#photoExit')?.addEventListener('click', closePhotoMode);
  $('#shutterBtn')?.addEventListener('click', takeShot);
  $('#photoGridBtn')?.addEventListener('click', () => {
    state.grid = !state.grid;
    $('#photoGrid')?.classList.toggle('hidden', !state.grid);
    $('#photoGridBtn')?.classList.toggle('active', state.grid);
  });
  $('#photoGalleryBtn')?.addEventListener('click', openGallery);
  $('#photoShareBtn')?.addEventListener('click', () => {
    if (!state.lastShot) { toast('Take a photo first', 'warn'); return; }
    download(state.lastShot.blob, downloadName(`${app.project?.name || 'worldbox'}-${stamp()}`, 'png'));
  });

  $('#aspectSeg')?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      state.aspect = b.dataset.v;
      $$('#aspectSeg button').forEach((x) => x.classList.toggle('active', x === b));
      updateFrame();
    });
  });

  const lens = $('#lensSlider');
  lens?.addEventListener('input', () => {
    state.lens = Number(lens.value);
    applyLens();
  });

  $('#expoSlider')?.addEventListener('input', (e) => {
    state.exposure = Number(e.target.value);
    applyExposure();
  });

  $('#focusSlider')?.addEventListener('input', (e) => {
    state.focus = Number(e.target.value);
    app.settings.dof = true;
    app.settings.dofFocus = state.focus;
    applyDof();
    $('#focusVal').textContent = `${fmtFocus(state.focus)}m`;
  });

  $('#autoFocusBtn')?.addEventListener('click', autoFocus);

  $('#resSeg')?.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      state.resolution = Number(b.dataset.v);
      $$('#resSeg button').forEach((x) => x.classList.toggle('active', x === b));
    });
  });

  $('#downloadAllPhotos')?.addEventListener('click', downloadAllPhotos);

  // viewer
  $('#closePhotoViewer')?.addEventListener('click', closeViewer);
  $('#downloadPhoto')?.addEventListener('click', () => {
    const p = state.photos.find((x) => x.id === state.viewerId);
    if (p) download(p.blob, downloadName(`${app.project?.name || 'worldbox'}-${p.id}`, 'png'));
  });
  $('#deletePhoto')?.addEventListener('click', async () => {
    if (!state.viewerId) return;
    if (!(await confirmDialog('Delete this capture?', 'Delete'))) return;
    await storage.deletePhoto(state.viewerId);
    closeViewer();
    await refreshGallery();
    toast('Photo deleted', 'success');
  });
  $('#photoViewer')?.addEventListener('click', (e) => {
    if (e.target.id === 'photoViewer') closeViewer();
  });

  window.addEventListener('resize', () => { if (state.open) updateFrame(); });
  window.addEventListener('orientationchange', () => setTimeout(() => state.open && updateFrame(), 300));
}

export function openPhotoMode() {
  if (state.open) return;
  state.open = true;
  app.photoMode = true;
  document.body.classList.add('photo-mode');
  document.getElementById('onboarding')?.classList.add('hidden');
  $('#photoUI')?.classList.remove('hidden');
  $('#photoBtn')?.classList.add('active');
  app.engine.setHelperVisibility(false);
  app.world.select(null);

  state.baseFov = app.world.engine.camera.fov;
  // derive a lens value from the current vertical FOV (24mm sensor height)
  const rad2 = (state.baseFov * Math.PI) / 180;
  state.lens = Math.round(12 / Math.tan(rad2 / 2));
  const slider = $('#lensSlider');
  if (slider) {
    slider.min = 8;
    slider.max = 200;
    slider.value = state.lens;
  }
  applyLens();
  applyExposure();
  renderFilmChips();
  updateFrame();
  requestAnimationFrame(() => state.open && updateFrame());

  const env = app.project?.environment;
  if (env?.post?.dof?.aperture) {
    state.focus = app.settings.dofFocus || 8;
    if (slider) void slider;
    const fs = $('#focusSlider');
    if (fs) fs.value = state.focus;
    const fv = $('#focusVal');
    if (fv) fv.textContent = `${fmtFocus(state.focus)}m`;
  }
  haptic(12);
}

export function closePhotoMode() {
  if (!state.open) return;
  state.open = false;
  app.photoMode = false;
  document.body.classList.remove('photo-mode');
  $('#photoUI')?.classList.add('hidden');
  $('#photoBtn')?.classList.remove('active');
  app.engine.setHelperVisibility(true);
  app.engine.camera.fov = state.baseFov;
  app.engine.camera.updateProjectionMatrix();
  const env = app.project?.environment;
  if (env) app.engine.applyLook(env, app.settings);
  app.engine.updateBrackets();
}

function applyLens() {
  const fov = (2 * Math.atan(12 / Math.max(4, state.lens)) * 180) / Math.PI;
  const cam = app.engine.camera;
  cam.fov = clamp(fov, 4, 100);
  cam.updateProjectionMatrix();
  $('#lensVal').textContent = `${state.lens}mm`;
  $('#photoLens').textContent = `${state.lens}mm`;
  const slider = $('#lensSlider');
  if (slider) slider.value = state.lens;
}

function applyExposure() {
  const env = app.project?.environment;
  const base = env?.exposure ?? 1.05;
  const exposure = base * Math.pow(2, state.exposure);
  app.engine.gradePass.uniforms.uExposure.value = exposure;
  app.engine.renderer.toneMappingExposure = exposure;
  $('#expoVal').textContent = state.exposure.toFixed(2);
  const los = $('#expoSlider');
  if (los) los.value = state.exposure;
}

function applyDof() {
  const env = app.project?.environment;
  app.engine.applyLook(env, app.settings);
}

function fmtFocus(v) {
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

function updateFrame() {
  const frame = $('#photoFrame');
  if (!frame) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isPhone = vw < 760;
  const barRect = document.querySelector('.photo-bar')?.getBoundingClientRect();
  const topRect = document.querySelector('.photo-top')?.getBoundingClientRect();
  const topEdge = (topRect ? topRect.bottom : 66) + (isPhone ? 10 : 14);
  const bottomEdge = (barRect ? barRect.top : vh - 106) - (isPhone ? 14 : 14);
  const availW = vw - (isPhone ? 24 : 72);
  const availH = Math.max(200, bottomEdge - topEdge);
  let w = availW;
  let h = availH;
  if (state.aspect !== 'free') {
    const [a, b] = state.aspect.split(':').map(Number);
    const ratio = a / b;
    if (availW / availH > ratio) w = availH * ratio;
    else h = availW / ratio;
  }
  frame.style.width = `${Math.round(w)}px`;
  frame.style.height = `${Math.round(h)}px`;
  frame.style.left = '50%';
  frame.style.top = `${Math.round((topEdge + bottomEdge) / 2)}px`;
  frame.style.transform = 'translate(-50%, -50%)';
}

function renderFilmChips() {
  const wrap = $('#filmChips');
  if (!wrap) return;
  clear(wrap);
  for (const name of Object.keys(FILMS)) {
    const btn = el('button', { type: 'button', class: `chip${state.film === name ? ' active' : ''}` }, name);
    btn.addEventListener('click', () => {
      state.film = name;
      applyFilm(name);
      renderFilmChips();
      haptic(6);
    });
    wrap.append(btn);
  }
}

function applyFilm(name) {
  const film = FILMS[name] || FILMS.Clean;
  const env = app.project?.environment;
  if (!env) return;
  env.grade = { ...(env.grade || {}), ...film.grade };
  env.tone = film.tone;
  app.engine.applyLook(env, app.settings);
  applyExposure();
  emit('project:changed', { source: 'film' });
  app.history?.note('Film grade', 300);
}

async function autoFocus() {
  const rect = $('#photoFrame')?.getBoundingClientRect();
  if (!rect) return;
  autoFocusAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function autoFocusAt(clientX, clientY) {
  const engine = app.engine;
  const rect = engine.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, engine.camera);
  const hits = ray.intersectObjects(app.world.content.children, true);
  let dist = null;
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData?.recordId) o = o.parent;
    if (o?.userData?.recordId) { dist = h.distance; break; }
  }
  if (dist === null) dist = engine.camera.position.distanceTo(engine.controls.target);
  state.focus = clamp(Number(dist.toFixed(1)), 0.2, 120);
  const fs = $('#focusSlider');
  if (fs) fs.value = state.focus;
  const fv = $('#focusVal');
  if (fv) fv.textContent = `${fmtFocus(state.focus)}m`;
  app.settings.dof = true;
  app.settings.dofFocus = state.focus;
  applyDof();
  haptic(5);
  toast(`Focus ${fmtFocus(state.focus)} m`, 'success');
}

// ── capture ──────────────────────────────────────────────────
export async function takeShot() {
  if (!state.open) return;
  const engine = app.engine;
  const canvasRect = engine.canvas.getBoundingClientRect();
  const frameRect = $('#photoFrame').getBoundingClientRect();

  const flash = $('#flash');
  flash?.classList.remove('go');
  void flash?.offsetWidth;
  flash?.classList.add('go');
  haptic(18);

  let dataUrl = '';
  try {
    dataUrl = engine.captureDataURL(state.resolution, 4096);
  } catch (e) {
    console.error(e);
  }
  if (!dataUrl) {
    toast('Capture failed on this device', 'err');
    return;
  }

  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const sx = ((frameRect.left - canvasRect.left) / canvasRect.width) * img.width;
    const sy = ((frameRect.top - canvasRect.top) / canvasRect.height) * img.height;
    const sw = (frameRect.width / canvasRect.width) * img.width;
    const sh = (frameRect.height / canvasRect.height) * img.height;
    const outW = Math.max(2, Math.round(sw));
    const outH = Math.max(2, Math.round(sh));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    if (app.settings.photoWatermark) {
      ctx.font = `${Math.round(outW * 0.018)}px -apple-system, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.textAlign = 'right';
      ctx.fillText('WORLDBOX', outW - outW * 0.03, outH - outH * 0.03);
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no blob');
    const thumbCanvas = document.createElement('canvas');
    const tScale = Math.min(1, 520 / Math.max(outW, outH));
    thumbCanvas.width = Math.round(outW * tScale);
    thumbCanvas.height = Math.round(outH * tScale);
    thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumb = thumbCanvas.toDataURL('image/webp', 0.82);

    const photo = {
      id: uid('shot'),
      createdAt: Date.now(),
      blob,
      thumb,
      width: outW,
      height: outH,
      meta: {
        lens: state.lens,
        film: state.film,
        exposure: state.exposure,
        world: app.project?.name || 'Untitled World',
      },
    };
    await storage.addPhoto(photo);
    state.lastShot = photo;
    state.photos.unshift(photo);
    toast(`Captured · ${outW}×${outH}`, 'success');
  } catch (e) {
    console.error('[photo]', e);
    toast('Could not save that capture', 'err');
  }
}

// ── gallery ──────────────────────────────────────────────────
export async function openGallery() {
  await refreshGallery();
  openSheet('gallerySheet');
}

export async function refreshGallery() {
  const grid = $('#galleryGrid');
  if (!grid) return;
  const photos = await storage.listPhotos();
  state.photos = photos;
  clear(grid);
  $('#galleryEmpty')?.classList.toggle('hidden', photos.length > 0);
  for (const p of photos) {
    const card = el('button', { class: 'gallery-card', type: 'button', title: new Date(p.createdAt).toLocaleString() },
      el('img', { src: p.thumb, alt: '' }),
      el('div', { class: 'g-meta' },
        el('span', {}, p.meta?.world || 'Worldbox'),
        el('span', {}, `${p.width}×${p.height}`)
      )
    );
    card.addEventListener('click', () => openViewer(p));
    grid.append(card);
  }
}

function openViewer(photo) {
  closeViewerUrl();
  state.viewerId = photo.id;
  state.viewerUrl = URL.createObjectURL(photo.blob);
  const img = $('#photoViewerImg');
  img.src = state.viewerUrl;
  $('#photoViewer')?.classList.remove('hidden');
}

export function closeViewer() {
  $('#photoViewer')?.classList.add('hidden');
  closeViewerUrl();
  state.viewerId = null;
}

function closeViewerUrl() {
  if (state.viewerUrl) {
    URL.revokeObjectURL(state.viewerUrl);
    state.viewerUrl = null;
  }
  const img = $('#photoViewerImg');
  if (img) img.removeAttribute('src');
}

async function downloadAllPhotos() {
  const photos = await storage.listPhotos();
  if (!photos.length) { toast('No captures yet', 'warn'); return; }
  if (!window.JSZip) { toast('ZIP library not available', 'err'); return; }
  const zip = new window.JSZip();
  const folder = zip.folder('worldbox-captures');
  photos.forEach((p, i) => {
    folder.file(`${String(i + 1).padStart(2, '0')}-${p.id}.png`, p.blob);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, downloadName(`${app.project?.name || 'worldbox'}-captures`, 'zip'));
  toast(`${photos.length} photos exported`, 'success');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
