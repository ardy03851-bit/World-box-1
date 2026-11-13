import { app } from '../app.js';
import { PRESETS, getPreset, buildPresetProject, newEmptyProject } from '../presets.js';
import { mulberry32, downloadName } from '../core/util.js';
import { $, el, icon, clear, toast, showBusy, updateBusy, hideBusy, haptic, openSheet } from './kit.js';
import { saveProjectNow } from '../io.js';
import { storage } from '../assets/storage.js';

let featured = PRESETS[0];
let savedProject = null;
let onboardingStep = 0;
const ONBOARD = [
  {
    kicker: 'GESTURE 01',
    title: 'Orbit with your hand',
    text: 'Drag anywhere to walk around the world. Two fingers pan, pinch zooms. The camera always eases, never jerks.',
  },
  {
    kicker: 'GESTURE 02',
    title: 'Tap it, then move it',
    text: 'Tap any object to select it. Drag the glass gizmo handles, or scrub the numbers in the inspector. Everything is live.',
  },
  {
    kicker: 'IMPORT',
    title: 'Bring your own worlds',
    text: 'Import GLB, FBX, OBJ, STL or a whole ZIP folder. Textures are matched to their maps automatically — drop one on a model to paint it.',
  },
  {
    kicker: 'SHOOT',
    title: 'Finish it like film',
    text: 'Shoot mode gives you focal lengths, focus, film grades and full-resolution captures. Then export the world as GLB or a portable file.',
  },
];

export function initHome() {
  app.startOnboarding = startOnboarding;
  app.home = {
    open: openHome,
    enter: enterPreset,
    continue: continueProject,
  };

  buildOrbField();
  selectFeatured(PRESETS[0]);

  $('#exploreBtn')?.addEventListener('click', () => enterPreset(featured.id));
  $('#createBtn')?.addEventListener('click', () => enterPreset('blank'));
  $('#homeClose')?.addEventListener('click', () => {
    if (app.started) closeHome();
    else enterPreset(featured.id);
  });
  $('#homeOpenFiles')?.addEventListener('click', () => {
    openSheet('librarySheet');
    app.ui?.openLibrary();
  });
  $('#homeHelpBtn')?.addEventListener('click', async () => {
    if (!app.started) await enterPreset(featured.id);
    app.ui?.setPanel('help');
  });
  $('#continueBtn')?.addEventListener('click', continueProject);

  $('#onboardNext')?.addEventListener('click', () => {
    if (onboardingStep < ONBOARD.length - 1) {
      onboardingStep++;
      renderOnboarding();
    } else {
      finishOnboarding();
    }
  });
  $('#onboardSkip')?.addEventListener('click', finishOnboarding);

  syncContinue();
  setTimeout(syncContinue, 800);
}

function buildOrbField() {
  const field = $('#orbField');
  if (!field) return;
  clear(field);
  const rnd = mulberry32(4821);
  const total = 20;
  for (let i = 0; i < total; i++) {
    const preset = PRESETS[i % PRESETS.length];
    const orb = el('button', {
      class: 'orb',
      type: 'button',
      title: preset.name,
      style: {
        '--s': (0.82 + rnd() * 0.3).toFixed(3),
        '--g': gradientFor(preset.palette),
      },
      dataset: { preset: preset.id },
    },
      el('i'),
      el('span', { class: 'orb-label' }, preset.name)
    );
    orb.addEventListener('click', () => {
      selectFeatured(preset);
      haptic(6);
    });
    orb.addEventListener('dblclick', () => enterPreset(preset.id));
    field.append(orb);
  }
  const create = el('button', { class: 'orb create-orb', type: 'button', title: 'Create your own' },
    el('div', { class: 'orb-grid-lines' }),
    el('span', {}, 'Create your own')
  );
  create.addEventListener('click', () => enterPreset('blank'));
  field.append(create);
}

function gradientFor(palette = []) {
  const p = palette.length ? palette : ['#fff', '#aaa', '#555', '#222'];
  return `radial-gradient(70% 55% at 32% 22%, ${p[0]}cc, transparent 72%), linear-gradient(155deg, ${p[1]} 0%, ${p[2]} 58%, ${p[3]} 100%)`;
}

function luminance(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function selectFeatured(preset) {
  featured = preset;
  const p = preset.palette || [];
  const hero = $('#heroOrb');
  if (!hero) return;
  hero.style.background = `radial-gradient(80% 60% at 50% 4%, rgba(255,255,255,.72), rgba(255,255,255,.18) 44%, transparent 76%), radial-gradient(130% 110% at 50% 120%, ${p[1] || '#9a9a9a'}, ${p[2] || '#555'} 48%, ${p[3] || '#222'})`;
  const dark = luminance(p[3] || '#222') < 0.32;
  hero.classList.toggle('dark', dark);
  $('#heroTitle').textContent = preset.name;
  $('#heroSub').textContent = preset.tagline || '';
  $('#heroMeta').textContent = `WORLDBOX STUDIO · ${preset.meta || 'PROCEDURAL'}`;
  $$orbActive(preset.id);
}

function $$orbActive(id) {
  document.querySelectorAll('.orb[data-preset]').forEach((o) => {
    o.style.outline = o.dataset.preset === id ? '1px solid rgba(255,255,255,.55)' : '';
    o.style.outlineOffset = o.dataset.preset === id ? '4px' : '';
  });
}

async function syncContinue() {
  try {
    const project = await storage.loadProject();
    savedProject = project;
    const btn = $('#continueBtn');
    const label = $('#continueLabel');
    if (project && btn) {
      btn.classList.remove('hidden');
      if (label) label.textContent = `Continue · ${project.name || 'Untitled World'}`;
    }
  } catch { /* ignore */ }
}

function openHome() {
  const home = $('#home');
  home?.classList.remove('hidden');
  document.body.classList.remove('editing');
  selectFeatured(featured);
  syncContinue();
}

function closeHome() {
  $('#home')?.classList.add('hidden');
  document.body.classList.add('editing');
  app.engine?.resize();
}

async function enterPreset(id) {
  let project;
  if (id === 'continue') {
    return continueProject();
  }
  if (id === 'blank') {
    project = newEmptyProject();
  } else {
    const preset = getPreset(id);
    if (!preset) return;
    project = buildPresetProject(preset);
  }
  showBusy('Building world', 'Lighting the scene…');
  try {
    app.settings.suppressAutosave = true;
    await app.world.loadProject(project);
    app.project = project;
    app.started = true;
    app.history?.reset();
    closeHome();
    app.ui?.enterEditor();
    app.settings.lastPreset = id;
    app.settings.lastWorld = project.name;
    saveSettings();
    await storage.saveProject(project);
    updateBusy('Ready', 1);
    toast(`${project.name} ready`, 'success');
    haptic(14);
    setTimeout(() => app.startOnboarding?.(), 700);
  } catch (e) {
    console.error('[home]', e);
    toast('Could not build that world', 'err');
  } finally {
    hideBusy();
    app.settings.suppressAutosave = false;
  }
}

async function continueProject() {
  let project = savedProject;
  if (!project) {
    project = await storage.loadProject();
  }
  if (!project) {
    toast('No saved world yet — pick a world to begin', 'warn');
    return;
  }
  showBusy('Restoring world', project.name || 'Opening…');
  try {
    app.settings.suppressAutosave = true;
    await app.world.loadProject(project);
    app.project = project;
    app.started = true;
    app.history?.reset();
    closeHome();
    app.ui?.enterEditor();
    updateBusy('Ready', 1);
    toast(`${project.name || 'World'} restored`, 'success');
    haptic(12);
  } catch (e) {
    console.error('[continue]', e);
    toast('That world could not be restored', 'err');
  } finally {
    hideBusy();
    app.settings.suppressAutosave = false;
  }
}

// ── onboarding ───────────────────────────────────────────────
function startOnboarding() {
  if (app.settings.onboardingDone) return;
  onboardingStep = 0;
  renderOnboarding();
  $('#onboarding')?.classList.remove('hidden');
}

function renderOnboarding() {
  const step = ONBOARD[onboardingStep];
  $('#onboardKicker').textContent = step.kicker;
  $('#onboardTitle').textContent = step.title;
  $('#onboardText').textContent = step.text;
  const dots = $('#onboardDots');
  clear(dots);
  ONBOARD.forEach((_, i) => dots.append(el('i', { class: i === onboardingStep ? 'active' : '' })));
  $('#onboardNext').textContent = onboardingStep === ONBOARD.length - 1 ? 'Start creating' : 'Next';
}

function finishOnboarding() {
  app.settings.onboardingDone = true;
  saveSettings();
  $('#onboarding')?.classList.add('hidden');
}

function saveSettings() {
  try { localStorage.setItem('worldbox:settings', JSON.stringify(app.settings)); } catch { /* ignore */ }
}

export { openHome, closeHome };
