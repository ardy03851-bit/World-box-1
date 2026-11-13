import { app, DEFAULT_SETTINGS } from './app.js';
import { on, emit } from './bus.js';
import { Engine } from './core/engine.js';
import { World } from './core/world.js';
import { History } from './core/history.js';
import { Library } from './assets/library.js';
import { storage } from './assets/storage.js';
import { newEmptyProject, EMPTY_WORLD } from './presets.js';
import { initUI } from './ui/appUI.js';
import { initPhoto } from './ui/photo.js';
import { initHome } from './ui/home.js';
import { initProjectFileInput, openProjectFile, saveProjectNow } from './io.js';
import { $, toast, showBusy, hideBusy, openSheet, confirmDialog } from './ui/kit.js';
import { debounce, throttle } from './core/util.js';

let autosaveTimer = null;

function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('worldbox:settings') || '{}');
  } catch { stored = {}; }
  return { ...DEFAULT_SETTINGS, ...stored };
}

function bootNote(text) {
  const node = $('#bootNote');
  if (node) node.textContent = text;
}

async function boot() {
  window.__worldbox = app;
  app.settings = loadSettings();
  app.settings.lockGround = true;

  const canvas = $('#viewport');
  if (!canvas) throw new Error('Viewport missing');

  bootNote('Starting the renderer…');
  const engine = new Engine(canvas);
  app.engine = engine;
  try {
    await engine.init();
  } catch (e) {
    console.error('[engine]', e);
    const note = $('#bootNote');
    if (note) note.textContent = 'This browser could not start WebGL 2 — try Safari or Chrome.';
    throw e;
  }

  bootNote('Reading your library…');
  const library = new Library();
  app.library = library;
  await library.init();

  app.project = newEmptyProject();
  app.project.name = 'Untitled World';

  const world = new World(engine.scene, engine);
  app.world = world;
  world.projectName = app.project.name;
  app.history = new History(world);

  engine.applyLook(app.project.environment, app.settings);
  engine.setGizmoSpace(app.settings.gizmoSpace || 'world');
  engine.setGizmoSnap(!!app.settings.gizmoSnap);
  engine.grid.visible = !!app.settings.showGrid;
  world.applyEnvironment(app.project.environment, { immediate: true });

  bootNote('Laying out the studio…');
  initUI();
  initPhoto();
  initHome();
  initProjectFileInput();

  app.history.reset();
  engine.resize();
  bootNote('Ready');

  wireViewport();
  wireAutosave();
  wireProjectEvents();

  setTimeout(() => {
    $('#boot')?.classList.add('done');
    setTimeout(() => $('#boot')?.classList.add('hidden'), 600);
    app.booted = true;
    // let the home screen breathe for a frame
    requestAnimationFrame(() => engine.resize());
    if (!app.settings.onboardingDone) {
      // onboarding appears once the user steps into a world
    }
  }, 350);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

function wireViewport() {
  const canvas = app.engine?.canvas;
  if (!canvas) return;
  let down = null;
  let lastTap = { t: 0, id: null };

  canvas.addEventListener('pointerdown', (e) => {
    app.flags.pointerDownOnCanvas = true;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), pointerType: e.pointerType };
  }, { passive: true });

  const endDown = () => { app.flags.pointerDownOnCanvas = false; };

  canvas.addEventListener('pointerup', (e) => {
    endDown();
    if (!down || app.photoMode) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const held = performance.now() - down.t;
    const clean = moved < 9 && held < 750 && !app.flags.gizmoDragging && !app.flags.draggingAsset;
    down = null;
    if (!clean) return;

    const rec = app.world?.pickRecord(e.clientX, e.clientY);
    if (!rec) {
      app.world?.select(null);
      lastTap = { t: 0, id: null };
      return;
    }
    const now = performance.now();
    const isDouble = lastTap.id === rec.id && now - lastTap.t < 340;
    app.world.select(rec.id);
    if (isDouble) {
      app.world.frameSelected();
      lastTap = { t: 0, id: null };
    } else {
      lastTap = { t: now, id: rec.id };
    }
  }, { passive: true });

  canvas.addEventListener('pointercancel', () => { endDown(); down = null; }, { passive: true });
  canvas.addEventListener('pointerleave', () => { app.engine?.hideHover?.(); });

  canvas.addEventListener('pointermove', throttle((e) => {
    if (e.pointerType !== 'mouse') return;
    if (app.flags.gizmoDragging || app.flags.draggingAsset || app.photoMode) return;
    if (e.buttons) return;
    const rec = app.world?.pickRecord(e.clientX, e.clientY);
    if (rec) app.engine?.showHover?.(rec.root);
    else app.engine?.hideHover?.();
  }, 60), { passive: true });
}

function wireAutosave() {
  const schedule = debounce(async () => {
    if (!app.settings.autoSave || !app.started || app.settings.suppressAutosave) return;
    if (!app.project) return;
    await saveProjectNow({ silent: true });
    const pill = $('#perfPill');
    if (pill) pill.classList.add('saved-flash');
    setTimeout(() => pill?.classList.remove('saved-flash'), 900);
  }, 1400);

  on('project:changed', () => {
    if (app.settings.suppressAutosave) return;
    app.history?.note('Edit', 360);
    schedule();
  });
  on('history:changed', () => schedule());
  on('gizmo:commit', () => schedule());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.started && app.settings.autoSave) {
      saveProjectNow({ silent: true });
    }
  });
}

function wireProjectEvents() {
  on('project:import-file', (file) => openProjectFile(file));
  on('project:import-data', (data) => {
    if (data?.version && Array.isArray(data.objects)) {
      (async () => {
        showBusy('Opening project', 'Restoring scene…');
        try {
          await app.world.loadProject(data);
          app.project = data;
          app.history.reset();
          app.ui.enterEditor();
          app.ui.refreshAll();
          toast('Project loaded', 'success');
        } catch (e) {
          console.error(e);
          toast('Could not load that project', 'err');
        } finally {
          hideBusy();
        }
      })();
    }
  });
  on('assets:changed', () => {
    $('#assetCount').textContent = String(app.library?.assets.size || 0);
  });
}

// graceful error surface
window.addEventListener('error', (e) => {
  console.error('[worldbox]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[worldbox] unhandled', e.reason);
});

boot().catch((err) => {
  console.error(err);
  const note = $('#bootNote');
  if (note) note.textContent = 'Something went wrong starting Worldbox. Reload to try again.';
});
