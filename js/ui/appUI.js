import { app } from '../app.js';
import { emit, on } from '../bus.js';
import { PRESETS, getPreset } from '../presets.js';
import { MATERIAL_PRESETS, TEXTURE_SLOTS } from '../core/materials.js';
import { PRIMITIVES } from '../core/objects.js';
import { debounce, clamp, rad, deg } from '../core/util.js';
import {
  $, $$, el, icon, clear, fmt, section, card, row, hint, button, iconButton,
  toggle, slider, segmented, chips, colorField, selectField, textField, scrubField,
  textureSlot, toast, confirmDialog, openModal, closeModals, openSheet, closeSheets,
  emptyState, haptic, showBusy, hideBusy, updateBusy,
} from './kit.js';
import { buildLeftPanel, PANEL_META } from './leftPanels.js';
import { openTexturePicker, refreshDock, refreshLibrary, initAssetsUI, importAndPlace, useAsset } from './assets-ui.js';
import { openPhotoMode } from './photo.js';
import { exportGLB, exportOBJ, exportProject, exportPortable, downloadSnapshot, copySnapshot, saveProjectNow, openProjectFile } from '../io.js';

export const ui = {};

let activeTransformMode = 'translate';
const inspectorScroll = { top: 0 };

export function initUI() {
  app.ui = ui;
  ui.init = () => {};
  ui.setPanel = setPanel;
  ui.refreshAll = refreshAll;
  ui.refreshLeft = refreshLeft;
  ui.refreshInspector = refreshInspector;
  ui.updateStats = updateStats;
  ui.setSceneName = setSceneName;
  ui.openLibrary = () => { openSheet('librarySheet'); refreshLibrary(); };
  ui.openExport = () => { renderExportMenu(); openModal('exportSheet'); };
  ui.openMenu = () => { renderMenu(); openModal('menuSheet'); };
  ui.openGallery = () => app.photo?.openGallery();
  ui.enterEditor = enterEditor;
  ui.showHome = showHome;
  ui.setMode = setMode;
  ui.promptName = promptName;

  initAssetsUI();
  wireTopbar();
  wireRail();
  wireTransformBar();
  wirePanels();
  wireModals();
  wireKeyboard();
  wireEvents();

  setMode('translate');
  setPanel('tools', { toggle: false });
  refreshInspector();
  if (navigator.maxTouchPoints > 0 && !app.selection) $('#inspector')?.classList.add('hidden');
  refreshDock();
  updateHistoryButtons({ canUndo: false, canRedo: false });

  let saved = null;
  try { saved = localStorage.getItem('worldbox:name'); } catch { /* storage blocked */ }
  if (saved) setSceneName(saved);
  return ui;
}

// ── panels ───────────────────────────────────────────────────
export function setPanel(name, { toggle = true } = {}) {
  const meta = PANEL_META[name] || PANEL_META.tools;
  const panel = $('#leftPanel');
  if (!meta) return;
  const isSame = app.activePanel === name && !panel.classList.contains('hidden');
  $$('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.panel === name && (!isSame || !toggle)));
  if (isSame && toggle) {
    panel.classList.add('hidden');
    return;
  }
  app.activePanel = name;
  panel.classList.remove('hidden');
  $('#leftKicker').textContent = meta.kicker;
  $('#leftTitle').textContent = meta.title;
  refreshLeft();
}

export function refreshLeft() {
  const name = app.activePanel || 'tools';
  const body = $('#leftBody');
  if (!body) return;
  const scrollTop = body.scrollTop;
  clear(body);
  body.append(buildLeftPanel(name, ctx()));
  body.scrollTop = scrollTop;
}

function ctx() {
  return {
    app,
    world: app.world,
    setPanel,
    refresh: refreshLeft,
    setMode,
    setSpace: (space) => {
      app.settings.gizmoSpace = space;
      app.settings.lastSpace = space;
      app.engine.setGizmoSpace(space);
      saveSettings();
      refreshLeft();
    },
    setSnap: (on) => {
      app.settings.gizmoSnap = on;
      app.engine.setGizmoSnap(on);
      saveSettings();
      refreshLeft();
      refreshTransformBar();
    },
    openLibrary: () => { openSheet('librarySheet'); refreshLibrary(); },
    openExport: () => { renderExportMenu(); openModal('exportSheet'); },
    openMenu: () => { renderMenu(); openModal('menuSheet'); },
    openSettings: () => setPanel('settings'),
    openPhoto: openPhotoMode,
    openGallery: () => app.photo?.openGallery(),
    applySettings: applySettingsChange,
    saveSettings,
    refreshAll,
    refreshInspector,
    promptName,
    focusSelected: () => app.world.frameSelected(),
    frameAll: () => app.world.frameAll(),
    toast,
    setSceneName,
    enterPreset,
    goHome: showHome,
    importAndPlace,
    useAsset,
    openTexturePicker,
    selectObject: (id) => app.world.select(id),
    refreshDock,
    refreshLibrary,
    downloadSnapshot,
    exportGLB,
    exportProject,
    exportPortable,
    renderExportMenu,
    updateStats,
    history: app.history,
    confirmDialog,
    openSheet,
    closeSheets,
  };
}

function refreshAll() {
  refreshLeft();
  refreshInspector();
  refreshDock();
  refreshLibrary();
  setSceneName(app.project?.name || app.world?.projectName);
  updateTransformBarVisibility();
}

function enterEditor() {
  document.body.classList.add('editing');
  $('#home')?.classList.add('hidden');
  setSceneName(app.project?.name || 'Untitled World');
  refreshAll();
  app.engine?.resize();
  if (!app.settings.onboardingDone) {
    setTimeout(() => app.startOnboarding?.(), 500);
  }
}

function showHome() {
  app.photo?.close();
  closeSheets();
  closeModals();
  app.home?.open();
}

// ── topbar / rail / toolbar ──────────────────────────────────
function wireTopbar() {
  $('#undoBtn')?.addEventListener('click', () => app.history?.undo());
  $('#redoBtn')?.addEventListener('click', () => app.history?.redo());
  $('#photoBtn')?.addEventListener('click', () => openPhotoMode());
  $('#exportBtn')?.addEventListener('click', () => { renderExportMenu(); openModal('exportSheet'); });
  $('#menuBtn')?.addEventListener('click', () => { renderMenu(); openModal('menuSheet'); });
  $('#viewBtn')?.addEventListener('click', () => { renderViewMenu(); openModal('viewSheet'); });
  $('#homeBtn')?.addEventListener('click', (e) => { e.preventDefault(); showHome(); });
  $('#sceneNameBtn')?.addEventListener('click', () => promptName(app.project?.name || 'Untitled World', (name) => {
    setSceneName(name);
    emit('project:changed', { source: 'name' });
  }));
  $('#dupBtn')?.addEventListener('click', () => { app.world.duplicateSelected(); });
  $('#delBtn')?.addEventListener('click', () => deleteSelected());
}

function wireRail() {
  $$('.rail-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPanel(btn.dataset.panel));
  });
  $$('[data-close="left"]').forEach((b) => b.addEventListener('click', () => $('#leftPanel').classList.add('hidden')));
  $$('[data-close="insp"]').forEach((b) => b.addEventListener('click', () => $('#inspector').classList.add('hidden')));
}

function wireTransformBar() {
  $$('#transformBar [data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('#snapBtn')?.addEventListener('click', () => {
    app.settings.gizmoSnap = !app.settings.gizmoSnap;
    app.engine.setGizmoSnap(app.settings.gizmoSnap);
    refreshTransformBar();
    saveSettings();
  });
  $('#spaceBtn')?.addEventListener('click', () => {
    app.settings.gizmoSpace = app.settings.gizmoSpace === 'world' ? 'local' : 'world';
    app.engine.setGizmoSpace(app.settings.gizmoSpace);
    refreshTransformBar();
    refreshLeft();
    saveSettings();
  });
  $('#focusBtn')?.addEventListener('click', () => app.world.frameSelected());
  $('#barDeleteBtn')?.addEventListener('click', () => deleteSelected());
}

export function setMode(mode) {
  activeTransformMode = mode;
  app.engine?.setGizmoMode(mode);
  $$('#transformBar [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $$('#leftBody [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}

function refreshTransformBar() {
  $('#snapBtn')?.classList.toggle('active', !!app.settings.gizmoSnap);
  $('#spaceBtn')?.classList.toggle('active', app.settings.gizmoSpace === 'local');
  $('#spaceBtn')?.setAttribute('title', app.settings.gizmoSpace === 'local' ? 'Local space' : 'World space');
}

function updateTransformBarVisibility() {
  const bar = $('#transformBar');
  if (!bar) return;
  bar.classList.toggle('hidden', !app.selection || app.photoMode);
}

function deleteSelected() {
  if (!app.selection) return;
  const rec = app.world.getSelectedRecord();
  if (!rec) return;
  app.world.removeRecord(app.selection);
  app.history?.note('Delete', 60);
  toast(`${rec.root.name} deleted`, 'success');
  haptic(10);
}

// ── modals ───────────────────────────────────────────────────
function wirePanels() {
  const panels = [
    ['#leftPanel', '#leftBody'],
    ['#inspector', '#inspectorBody'],
  ];
  for (const [panelSel, bodySel] of panels) {
    const panel = $(panelSel);
    const body = $(bodySel);
    panel?.querySelector('.panel-head')?.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      body?.classList.toggle('hidden');
      panel.classList.toggle('collapsed');
    });
  }
  $('#perfPill')?.addEventListener('click', () => {
    const s = app.engine?.stats || {};
    toast(`${s.fps || 0} fps · ${(s.triangles || 0).toLocaleString()} tris · ${app.engine?.renderer?.info?.render?.calls || 0} draws`, 'success');
  });
  $('#inspector')?.addEventListener('dblclick', (e) => {
    if (e.target.closest('input,button,.slider,.scrub')) return;
    if (app.selection) app.world.frameSelected();
  });
}

function wireModals() {
  $$('[data-close-menu]').forEach((b) => b.addEventListener('click', closeModals));
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m) closeModals();
    });
  });
  $('#menuSheet')?.addEventListener('click', (e) => {
    if (e.target.id === 'menuSheet') closeModals();
  });
}

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? app.history?.redo() : app.history?.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); app.history?.redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      app.world.duplicateSelected();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProjectNow();
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'w': setMode('translate'); break;
      case 'e': setMode('rotate'); break;
      case 'r': setMode('scale'); break;
      case 'f': app.world.frameSelected(); break;
      case 'g': {
        app.settings.showGrid = !app.settings.showGrid;
        app.world.engine.grid.visible = app.settings.showGrid;
        saveSettings();
        refreshLeft();
        break;
      }
      case 'p': openPhotoMode(); break;
      case 'escape':
        closeModals();
        closeSheets();
        if (app.photoMode) app.photo.close();
        else app.world.select(null);
        break;
      case 'delete':
      case 'backspace':
        deleteSelected();
        break;
      case 'tab':
        e.preventDefault();
        app.world.selectByIndex(e.shiftKey ? -1 : 1);
        break;
      case '[':
        app.world.alignSelected('floor');
        break;
      case ']':
        app.world.alignSelected('center');
        break;
      default: break;
    }
    if (e.key === 'Escape' && app.photoMode) app.photo.close();
  });

  window.addEventListener('beforeunload', () => {
    saveSettings();
    if (app.settings.autoSave) saveProjectNow({ silent: true, sync: true });
  });
}

function wireEvents() {
  on('selection:changed', (rec) => {
    app.selectedMaterial = 0;
    updateTransformBarVisibility();
    if (rec) {
      $('#inspector')?.classList.remove('hidden');
      refreshInspector();
    } else {
      refreshInspector();
    }
    refreshOutlinerSelection();
  });
  on('selection:refresh', () => refreshInspector());
  on('objects:changed', () => {
    refreshOutlinerSelection(true);
    updateSceneCountsInPanels();
  });
  on('material:changed', () => {});
  on('project:changed', () => {
    setSceneName(app.project?.name || app.world?.projectName);
  });
  on('project:loaded', () => {
    refreshAll();
    updateTransformBarVisibility();
    updateHistoryButtons({ canUndo: app.history?.canUndo, canRedo: app.history?.canRedo });
  });
  on('history:changed', updateHistoryButtons);
  on('engine:stats', updateStats);
  on('gizmo:commit', () => {
    if (app.selection) app.world.syncTransform(app.selection);
    app.history?.flush();
    syncTransformFields();
  });
  on('gizmo:change', syncTransformFields);
  on('toast', ({ text, type }) => toast(text, type === 'info' ? 'success' : type));
  on('environment:changed', () => {
    if (app.activePanel === 'look') {
      // avoid rebuilding while dragging sliders: only refresh chrome-free controls
    }
  });
}

function updateHistoryButtons(state = {}) {
  const canUndo = state.canUndo ?? app.history?.canUndo;
  const canRedo = state.canRedo ?? app.history?.canRedo;
  const u = $('#undoBtn');
  const r = $('#redoBtn');
  if (u) u.disabled = !canUndo;
  if (r) r.disabled = !canRedo;
}

function updateStats({ fps, triangles }) {
  if (!app.settings?.showPerf) {
    $('#perfPill')?.classList.add('hidden');
    return;
  }
  $('#perfPill')?.classList.remove('hidden');
  const fpsNode = $('#fpsText');
  const triNode = $('#triText');
  if (fpsNode) fpsNode.textContent = `${fps} FPS`;
  if (triNode) {
    const t = triangles || 0;
    triNode.textContent = t > 1e6 ? `${(t / 1e6).toFixed(2)}M tris` : t > 1000 ? `${(t / 1000).toFixed(1)}k tris` : `${t} tris`;
  }
  $('#perfPill')?.classList.toggle('warn', fps < 42);
}

function setSceneName(name) {
  const n = name || 'Untitled World';
  const node = $('#sceneName');
  if (node) node.textContent = n;
  if (app.project) app.project.name = n;
  if (app.world) app.world.projectName = n;
  try { localStorage.setItem('worldbox:name', n); } catch { /* ignore */ }
}

// ── inspector ────────────────────────────────────────────────
export function refreshInspector() {
  const body = $('#inspectorBody');
  if (!body) return;
  inspectorScroll.top = body.scrollTop;
  clear(body);
  const rec = app.world?.getSelectedRecord();
  const panel = $('#inspector');
  if (!rec) {
    panel.classList.add('is-empty');
    $('#inspKicker').textContent = 'WORKSPACE';
    $('#inspTitle').textContent = 'Inspector';
    body.append(emptyInspector());
    if (navigator.maxTouchPoints === 0) panel.classList.remove('hidden');
    body.scrollTop = 0;
    return;
  }
  panel.classList.remove('is-empty');
  const kindLabel = {
    primitive: 'PRIMITIVE',
    terrain: 'TERRAIN',
    light: 'LIGHT',
    asset: 'MODEL',
    group: 'GROUP',
  }[rec.desc.kind] || 'OBJECT';
  $('#inspKicker').textContent = kindLabel;
  $('#inspTitle').textContent = rec.root.name || 'Object';

  body.append(buildObjectHeader(rec));
  body.append(buildTransformSection(rec));
  if (rec.desc.kind === 'light') {
    body.append(buildLightSection(rec));
  } else {
    if (rec.desc.kind === 'terrain') body.append(buildTerrainSection(rec));
    if (rec.desc.kind === 'primitive') body.append(buildShapeSection(rec));
    if (rec.desc.kind === 'asset') body.append(buildAssetInfo(rec));
    body.append(buildMaterialSection(rec));
    body.append(buildToolsSection(rec));
  }
  body.scrollTop = inspectorScroll.top;
}

function emptyInspector() {
  const scene = app.project;
  const count = app.world?.records.size || 0;
  return el('div', { class: 'insp-empty' },
    emptyState('Nothing selected', 'Tap any object in the scene to edit its shape, material and light. Panels stay out of your way.', 'cursor'),
    card(
      row('Objects', el('span', { class: 'mini' }, String(count))),
      row('World', el('span', { class: 'mini' }, scene?.name || 'Untitled')),
      row('Tone', el('span', { class: 'mini' }, (app.project?.environment?.tone || 'aces').toUpperCase()))
    ),
    el('div', { class: 'btn-row' },
      button('Terrain', { iconName: 'mountain', onClick: () => { app.world.addTerrain(); refreshInspector(); } }),
      button('Light', { iconName: 'light', onClick: () => { app.world.addLight('point'); refreshInspector(); } })
    ),
    el('div', { class: 'btn-row' },
      button('Sphere', { iconName: 'sphere', onClick: () => { app.world.addPrimitive('sphere'); refreshInspector(); } }),
      button('Box', { iconName: 'cube', onClick: () => { app.world.addPrimitive('cube'); refreshInspector(); } })
    ),
    hint('Tip · <b>Tap</b> to select, <b>double-tap</b> to frame, <b>drag</b> the gizmo handles to move.')
  );
}

function buildObjectHeader(rec) {
  const vis = rec.root.visible;
  const locked = !!rec.desc.locked;
  return el('div', { class: 'object-head' },
    el('div', { class: 'object-name' },
      icon(rec.desc.kind === 'light' ? 'light' : rec.desc.kind === 'terrain' ? 'mountain' : rec.desc.kind === 'asset' ? 'cube' : 'sphere'),
      textField({
        value: rec.root.name,
        onCommit: (v) => {
          if (!v) return;
          app.world.rename(rec.id, v);
          refreshInspector();
          app.history?.note('Rename', 100);
        },
      })
    ),
    el('div', { class: 'object-flags' },
      iconButton(vis ? 'eye' : 'eye-off', () => {
        app.world.setVisibility(rec.id, !vis);
        refreshInspector();
        app.history?.note('Visibility', 100);
      }, { title: vis ? 'Hide' : 'Show' }),
      iconButton(locked ? 'lock' : 'unlock', () => {
        app.world.setLocked(rec.id, !locked);
        refreshInspector();
        app.history?.note('Lock', 100);
      }, { title: locked ? 'Unlock' : 'Lock' })
    )
  );
}

function buildTransformSection(rec) {
  const root = rec.root;
  const p = root.position;
  const r = root.rotation;
  const s = root.scale;
  const posFields = el('div', { class: 'xyz', id: 'tf-pos' },
    scrubField({ axis: 'x', value: p.x, step: 0.02, onChange: (v) => setTransform({ x: v }), onCommit: () => commitTransform() }),
    scrubField({ axis: 'y', value: p.y, step: 0.02, onChange: (v) => setTransform({ y: v }), onCommit: () => commitTransform() }),
    scrubField({ axis: 'z', value: p.z, step: 0.02, onChange: (v) => setTransform({ z: v }), onCommit: () => commitTransform() })
  );
  const rotFields = el('div', { class: 'xyz', id: 'tf-rot' },
    scrubField({ axis: 'x', value: deg(r.x), step: 0.5, precision: 1, onChange: (v) => setTransform({ rx: rad(v) }), onCommit: () => commitTransform() }),
    scrubField({ axis: 'y', value: deg(r.y), step: 0.5, precision: 1, onChange: (v) => setTransform({ ry: rad(v) }), onCommit: () => commitTransform() }),
    scrubField({ axis: 'z', value: deg(r.z), step: 0.5, precision: 1, onChange: (v) => setTransform({ rz: rad(v) }), onCommit: () => commitTransform() })
  );
  const scaleFields = el('div', { class: 'xyz', id: 'tf-scale' },
    scrubField({ axis: 'x', value: s.x, step: 0.01, onChange: (v) => setScale(v, 'x'), onCommit: () => commitTransform() }),
    scrubField({ axis: 'y', value: s.y, step: 0.01, onChange: (v) => setScale(v, 'y'), onCommit: () => commitTransform() }),
    scrubField({ axis: 'z', value: s.z, step: 0.01, onChange: (v) => setScale(v, 'z'), onCommit: () => commitTransform() })
  );

  const body = el('div', { class: 'stack' },
    el('div', {}, el('div', { class: 'sub-label' }, 'POSITION'), posFields),
    el('div', {}, el('div', { class: 'sub-label' }, 'ROTATION °'), rotFields),
    el('div', {}, el('div', { class: 'sub-label' }, 'SCALE'), scaleFields),
    el('div', { class: 'mini-actions' },
      button('Drop', { small: true, iconName: 'download', onClick: () => { app.world.dropSelectedToFloor(); refreshInspector(); app.history?.note('Drop', 80); } }),
      button('Center', { small: true, iconName: 'target', onClick: () => { app.world.alignSelected('center'); refreshInspector(); app.history?.note('Center', 80); } }),
      button('Frame', { small: true, iconName: 'focus', onClick: () => app.world.frameSelected() }),
      button('Reset', { small: true, iconName: 'refresh', onClick: () => {
        setTransform({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
        setScale(1, 'xyz');
        commitTransform();
        refreshInspector();
      } })
    )
  );
  return section('Transform', body);
}

function setTransform(patch) {
  const rec = app.world.getSelectedRecord();
  if (!rec) return;
  const r = rec.root;
  if (patch.x !== undefined) r.position.x = patch.x;
  if (patch.y !== undefined) r.position.y = patch.y;
  if (patch.z !== undefined) r.position.z = patch.z;
  if (patch.rx !== undefined) r.rotation.x = patch.rx;
  if (patch.ry !== undefined) r.rotation.y = patch.ry;
  if (patch.rz !== undefined) r.rotation.z = patch.rz;
  r.updateMatrixWorld(true);
  app.engine.updateBrackets();
  markDirty();
}

function setScale(v, axis) {
  const rec = app.world.getSelectedRecord();
  if (!rec) return;
  const s = clamp(v, -50, 500);
  if (axis === 'xyz') rec.root.scale.set(s, s, s);
  else rec.root.scale[axis] = s;
  rec.root.updateMatrixWorld(true);
  app.engine.updateBrackets();
  markDirty();
}

let dirtyTimer = null;
function markDirty() {
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => {
    if (app.selection) app.world.syncTransform(app.selection);
  }, 220);
}

function commitTransform() {
  if (app.selection) app.world.syncTransform(app.selection);
  app.history?.note('Transform', 120);
}

function syncTransformFields() {
  const rec = app.world.getSelectedRecord();
  if (!rec) return;
  const p = rec.root.position;
  const r = rec.root.rotation;
  const s = rec.root.scale;
  const setAll = (id, values, precision = 2) => {
    const fields = $$(`#${id} .scrub input`);
    if (fields.length !== values.length) return;
    fields.forEach((inp, i) => {
      if (document.activeElement === inp) return;
      inp.value = fmt(values[i], precision);
    });
  };
  setAll('tf-pos', [p.x, p.y, p.z]);
  setAll('tf-rot', [deg(r.x), deg(r.y), deg(r.z)], 1);
  setAll('tf-scale', [s.x, s.y, s.z]);
}

function buildShapeSection(rec) {
  const prim = rec.desc.primitive;
  const def = PRIMITIVES.find((p) => p.type === prim.type);
  const typeSelect = selectField({
    options: PRIMITIVES.map((p) => ({ value: p.type, label: p.label })),
    value: prim.type,
    onChange: (v) => {
      const d = PRIMITIVES.find((p) => p.type === v);
      app.world.updateDescriptor(rec.id, (desc) => {
        desc.primitive = { type: v, params: { ...d.params } };
        desc.name = d.label;
      }, { rebuild: true });
      app.history?.note('Shape', 100);
      refreshInspector();
    },
  });

  const params = prim.params || {};
  const controls = [];
  const paramDefs = {
    sphere: [['radius', 'Radius', 0.1, 8], ['widthSegments', 'Segments', 8, 128, 1]],
    cube: [['width', 'Width', 0.05, 12], ['height', 'Height', 0.05, 12], ['depth', 'Depth', 0.05, 12]],
    cylinder: [['radiusTop', 'Top radius', 0.05, 6], ['radiusBottom', 'Bottom radius', 0.05, 6], ['height', 'Height', 0.05, 12], ['segments', 'Segments', 6, 160, 1]],
    cone: [['radius', 'Radius', 0.05, 6], ['height', 'Height', 0.05, 12], ['segments', 'Segments', 6, 160, 1]],
    capsule: [['radius', 'Radius', 0.05, 4], ['height', 'Height', 0.05, 10], ['radialSegments', 'Segments', 8, 96, 1]],
    torus: [['radius', 'Radius', 0.05, 8], ['tube', 'Thickness', 0.01, 2], ['tubularSegments', 'Detail', 8, 320, 1]],
    torusKnot: [['radius', 'Radius', 0.05, 6], ['tube', 'Thickness', 0.01, 1.2], ['p', 'P', 1, 8, 1], ['q', 'Q', 1, 8, 1]],
    plane: [['width', 'Width', 0.1, 40], ['height', 'Height', 0.1, 40]],
    icosahedron: [['radius', 'Radius', 0.05, 5], ['detail', 'Detail', 0, 4, 1]],
    octahedron: [['radius', 'Radius', 0.05, 5], ['detail', 'Detail', 0, 4, 1]],
    dodecahedron: [['radius', 'Radius', 0.05, 5], ['detail', 'Detail', 0, 4, 1]],
    ring: [['innerRadius', 'Inner', 0.05, 8], ['outerRadius', 'Outer', 0.05, 8]],
    shard: [['radius', 'Radius', 0.05, 5], ['height', 'Height', 0.1, 20], ['sides', 'Sides', 3, 12, 1]],
  }[prim.type] || [];

  const rebuildDebounced = debounce((key, value) => {
    app.world.updateDescriptor(rec.id, (desc) => {
      desc.primitive.params[key] = value;
    }, { rebuild: true, reselect: true });
    app.history?.note('Geometry', 250);
  }, 380);

  for (const [key, label, min, max, step] of paramDefs) {
    controls.push(slider({
      label,
      min,
      max,
      step: step || (max <= 10 ? 0.01 : 1),
      value: params[key] ?? min,
      precision: (step || 0.01) < 1 ? 2 : 0,
      onInput: (v) => rebuildDebounced(key, v),
      onChange: (v) => {
        app.world.updateDescriptor(rec.id, (desc) => { desc.primitive.params[key] = v; }, { rebuild: true, reselect: true });
        app.history?.note('Geometry', 100);
      },
    }));
  }

  return section('Shape', [typeSelect, ...controls], { collapsed: true });
}

function buildTerrainSection(rec) {
  const t = rec.desc.terrain;
  const update = debounce((key, value) => {
    app.world.updateDescriptor(rec.id, (d) => { d.terrain[key] = value; }, { rebuild: true, reselect: true });
    app.history?.note('Terrain', 300);
  }, 420);
  const setNow = (key, value) => {
    app.world.updateDescriptor(rec.id, (d) => { d.terrain[key] = value; }, { rebuild: true, reselect: true });
    app.history?.note('Terrain', 120);
  };
  const water = t.water || {};
  return section('Terrain', [
    el('div', { class: 'btn-row' },
      button('Randomise', { small: true, iconName: 'refresh', onClick: () => {
        app.world.updateDescriptor(rec.id, (d) => { d.terrain.seed = Math.floor(Math.random() * 9999); }, { rebuild: true, reselect: true });
        app.history?.note('Terrain seed', 100);
        refreshInspector();
      } }),
      button('Water', { small: true, iconName: 'globe', onClick: () => {
        app.world.updateDescriptor(rec.id, (d) => {
          d.terrain.water = { enabled: !(d.terrain.water?.enabled), level: d.terrain.water?.level ?? 0.6, color: d.terrain.water?.color || '#356f80', opacity: 0.85, roughness: 0.08 };
        }, { rebuild: true, reselect: true });
        app.history?.note('Water', 100);
        refreshInspector();
      } }),
    ),
    slider({ label: 'Amplitude', min: 0.2, max: 30, step: 0.1, value: t.amp ?? 4, onInput: (v) => update('amp', v), onChange: (v) => setNow('amp', v) }),
    slider({ label: 'Frequency', min: 0.1, max: 4, step: 0.02, value: t.freq ?? 1, precision: 2, onInput: (v) => update('freq', v), onChange: (v) => setNow('freq', v) }),
    slider({ label: 'Octaves', min: 1, max: 8, step: 1, value: t.octaves ?? 5, precision: 0, onInput: (v) => update('octaves', v), onChange: (v) => setNow('octaves', v) }),
    slider({ label: 'Detail', min: 20, max: 320, step: 10, value: t.resolution ?? 150, precision: 0, onInput: (v) => update('resolution', v), onChange: (v) => setNow('resolution', v) }),
    toggle(!!t.ridged, (v) => setNow('ridged', v), { label: 'Ridged ridges' }),
    t.water?.enabled ? el('div', { class: 'stack' },
      slider({ label: 'Water level', min: -10, max: 20, step: 0.1, value: t.water.level ?? 0.6, onInput: (v) => update('water', { ...t.water, level: v }), onChange: (v) => setNow('water', { ...t.water, level: v }) }),
      row('Water tint', colorField({ value: t.water.color || '#356f80', onChange: (v) => setNow('water', { ...t.water, color: v }) }))
    ) : null,
    hint('Terrain is generated from layered noise — change the seed, then sculpt the look with material presets below.'),
  ], { collapsed: false });
}

function buildLightSection(rec) {
  const l = rec.desc.light || {};
  const obj = rec.root;
  const set = (key, value, { rebuild = false } = {}) => {
    if (rebuild) {
      app.world.updateDescriptor(rec.id, (d) => { d.light = { ...d.light, [key]: value }; }, { rebuild: true, reselect: true });
      app.history?.note('Light', 120);
      refreshInspector();
      return;
    }
    rec.desc.light = { ...l, [key]: value };
    if (key === 'color') obj.color?.set(value);
    else if (key === 'intensity') obj.intensity = value;
    else if (key === 'distance') obj.distance = value;
    else if (key === 'angle' && obj.isSpotLight) obj.angle = rad(value);
    else if (key === 'penumbra' && obj.isSpotLight) obj.penumbra = value;
    else if (key === 'castShadow') obj.castShadow = value;
    else if (key === 'groundColor') obj.groundColor?.set(value);
    emit('project:changed', { source: 'light' });
  };
  const body = el('div', { class: 'stack' },
    segmented({
      options: [{ value: 'directional', label: 'Sun' }, { value: 'point', label: 'Point' }, { value: 'spot', label: 'Spot' }, { value: 'hemi', label: 'Sky' }],
      value: l.type || 'point',
      full: true,
      small: true,
      onChange: (v) => set('type', v, { rebuild: true }),
    }),
    row('Color', colorField({ value: l.color || '#ffe9cf', onChange: (v) => set('color', v) })),
    slider({ label: 'Intensity', min: 0, max: 80, step: 0.1, value: l.intensity ?? 3, precision: 1, onInput: (v) => set('intensity', v) }),
    (l.type === 'spot') ? slider({ label: 'Cone angle', min: 5, max: 85, step: 1, value: l.angle ?? 42, precision: 0, onInput: (v) => set('angle', v) }) : null,
    (l.type === 'spot') ? slider({ label: 'Softness', min: 0, max: 1, step: 0.01, value: l.penumbra ?? 0.5, onInput: (v) => set('penumbra', v) }) : null,
    (l.type === 'point' || l.type === 'spot') ? slider({ label: 'Range (0 = ∞)', min: 0, max: 120, step: 1, value: l.distance ?? 0, precision: 0, onInput: (v) => set('distance', v) }) : null,
    (l.type === 'hemi') ? row('Ground tint', colorField({ value: l.groundColor || '#22252c', onChange: (v) => set('groundColor', v) })) : null,
    toggle(!!l.castShadow, (v) => set('castShadow', v), { label: 'Cast shadows' }),
    hint('Lights are objects — move them with the gizmo, or animate the sun from the Look panel.')
  );
  return section('Light', body);
}

function buildAssetInfo(rec) {
  const asset = app.library.get(rec.desc.assetId);
  const meta = asset?.meta || {};
  return section('Model', [
    card(
      row('Triangles', el('span', { class: 'mini' }, (meta.triangles || 0).toLocaleString())),
      row('Source', el('span', { class: 'mini' }, (asset?.ext || 'glb').toUpperCase())),
      row('Materials', el('span', { class: 'mini' }, String(meta.materials?.length || 0))),
      meta.animations ? row('Animations', el('span', { class: 'mini' }, String(meta.animations))) : null
    ),
    el('div', { class: 'btn-row' },
      button('Smart match', { small: true, iconName: 'sparkles', onClick: async () => {
        const count = await app.library.rematchObject(rec.root, rec.root.name);
        if (count) { refreshInspector(); app.history?.note('Smart textures', 100); }
      } }),
      button('Reframe', { small: true, iconName: 'focus', onClick: () => app.world.frameSelected() })
    ),
  ], { collapsed: false });
}

function buildMaterialSection(rec) {
  const entries = app.world.materialEntries(rec);
  if (!entries.length) return card(hint('This object has no editable materials.'));
  const idx = clamp(app.selectedMaterial, 0, entries.length - 1);
  const entry = entries[idx];
  const state = entry.state;
  const mat = entry.material;
  const controls = [];

  if (entries.length > 1) {
    const select = el('select');
    entries.forEach((e, i) => {
      const o = el('option', { value: String(i) }, e.label);
      if (i === idx) o.selected = true;
      select.append(o);
    });
    select.addEventListener('change', () => {
      app.selectedMaterial = Number(select.value);
      refreshInspector();
    });
    controls.push(select);
  }

  const presetKeys = ['ceramic', 'clay', 'chrome', 'gold', 'glass', 'obsidian', 'neon', 'frosted'];
  controls.push(chips({
    options: presetKeys.map((k) => ({ value: k, label: MATERIAL_PRESETS[k].label })),
    value: state.preset,
    onChange: (v) => {
      app.world.applyMaterialPreset(v, idx);
      refreshInspector();
      app.history?.note('Material preset', 120);
    },
    small: true,
  }));

  const setProp = (key, value, { needsUpdate = false } = {}) => {
    app.world.editMaterial((m) => {
      if (key === 'color') m.color?.set(value);
      else if (key === 'emissive') m.emissive?.set(value);
      else if (key === 'sheenColor') m.sheenColor?.set(value);
      else if (key === 'side') m.side = { front: 0, back: 1, double: 2 }[value] ?? 0;
      else m[key] = value;
      if (key === 'opacity') m.transparent = value < 0.999;
      if (key === 'flatShading' || key === 'side') m.needsUpdate = true;
      if (needsUpdate) m.needsUpdate = true;
    }, idx);
    app.history?.note('Material', 420);
  };

  controls.push(row('Base color', colorField({ value: state.color, onChange: (v) => setProp('color', v) })));
  controls.push(slider({ label: 'Metalness', min: 0, max: 1, step: 0.01, value: state.metalness, onInput: (v) => setProp('metalness', v) }));
  controls.push(slider({ label: 'Roughness', min: 0, max: 1, step: 0.01, value: state.roughness, onInput: (v) => setProp('roughness', v) }));
  controls.push(slider({ label: 'Environment', min: 0, max: 3, step: 0.01, value: state.envMapIntensity, onInput: (v) => setProp('envMapIntensity', v) }));

  const physics = el('div', { class: 'stack' },
    slider({ label: 'Transmission', min: 0, max: 1, step: 0.01, value: state.transmission ?? 0, onInput: (v) => setProp('transmission', v) }),
    slider({ label: 'Thickness', min: 0, max: 4, step: 0.01, value: state.thickness ?? 0, onInput: (v) => setProp('thickness', v) }),
    slider({ label: 'IOR', min: 1, max: 2.5, step: 0.01, value: state.ior ?? 1.5, onInput: (v) => setProp('ior', v) }),
    slider({ label: 'Clearcoat', min: 0, max: 1, step: 0.01, value: state.clearcoat ?? 0, onInput: (v) => setProp('clearcoat', v) }),
    slider({ label: 'Coat roughness', min: 0, max: 1, step: 0.01, value: state.clearcoatRoughness ?? 0, onInput: (v) => setProp('clearcoatRoughness', v) }),
    slider({ label: 'Iridescence', min: 0, max: 1, step: 0.01, value: state.iridescence ?? 0, onInput: (v) => setProp('iridescence', v) }),
    slider({ label: 'Opacity', min: 0.02, max: 1, step: 0.01, value: state.opacity ?? 1, onInput: (v) => setProp('opacity', v) }),
    row('Emission', colorField({ value: state.emissive || '#000000', onChange: (v) => setProp('emissive', v) })),
    slider({ label: 'Emission power', min: 0, max: 12, step: 0.1, value: state.emissiveIntensity ?? 1, precision: 1, onInput: (v) => setProp('emissiveIntensity', v) }),
    toggle(!!state.wireframe, (v) => setProp('wireframe', v), { label: 'Wireframe' }),
    toggle(!!state.flatShading, (v) => setProp('flatShading', v, { needsUpdate: true }), { label: 'Flat shading' }),
    row('Side', segmented({
      options: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'double', label: 'Double' }],
      value: state.side || 'front',
      small: true,
      onChange: (v) => setProp('side', v),
    }))
  );
  controls.push(section('Surface physics', physics, { collapsed: true }));

  const mapSlots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
  const extraSlots = TEXTURE_SLOTS.filter((s) => !mapSlots.includes(s.key));
  const slotNodes = mapSlots.map((slotKey) => {
    const info = TEXTURE_SLOTS.find((s) => s.key === slotKey);
    const texId = state.maps?.[slotKey];
    const asset = texId ? app.library.get(texId) : null;
    return textureSlot({
      slot: slotKey,
      label: info.label,
      asset,
      onClear: () => { app.world.setTextureOnMaterial(slotKey, null, idx); refreshInspector(); app.history?.note('Texture', 100); },
      onPick: () => openTexturePicker(slotKey, async (id) => {
        await app.library.ensureTexture(id).catch(() => null);
        app.world.setTextureOnMaterial(slotKey, id, idx);
        refreshInspector();
        app.history?.note('Texture', 100);
      }),
      onDropped: (id) => { app.world.setTextureOnMaterial(slotKey, id, idx); refreshInspector(); },
    });
  });
  const extraNodes = extraSlots.map((s) => {
    const texId = state.maps?.[s.key];
    const asset = texId ? app.library.get(texId) : null;
    return textureSlot({
      slot: s.key,
      label: s.label,
      asset,
      onClear: () => { app.world.setTextureOnMaterial(s.key, null, idx); refreshInspector(); },
      onPick: () => openTexturePicker(s.key, async (id) => {
        await app.library.ensureTexture(id).catch(() => null);
        app.world.setTextureOnMaterial(s.key, id, idx);
        refreshInspector();
      }),
    });
  });

  const uv = state.uv || { repeat: [1, 1], offset: [0, 0], rotation: 0 };
  const setUV = (key, val) => {
    app.world.editMaterial((m) => {
      for (const slot of TEXTURE_SLOTS) {
        const tex = m[slot.key];
        if (!tex) continue;
        if (key === 'repeat') { tex.wrapS = tex.wrapT = 1000; tex.repeat.set(val, val); }
        if (key === 'rotation') tex.rotation = val;
        tex.needsUpdate = true;
      }
    }, idx);
    app.history?.note('UV', 400);
  };

  controls.push(section('Textures', [
    ...slotNodes,
    section('More maps', extraNodes, { collapsed: true }),
    slider({ label: 'Tiling', min: 0.2, max: 12, step: 0.1, value: uv.repeat?.[0] ?? 1, precision: 1, onInput: (v) => setUV('repeat', v) }),
    slider({ label: 'Rotation', min: 0, max: 6.28, step: 0.01, value: uv.rotation ?? 0, onInput: (v) => setUV('rotation', v) }),
    hint('Drag a texture from the library straight onto a slot — or onto the model in the viewport.')
  ], { collapsed: false }));

  controls.push(el('div', { class: 'btn-row' },
    button('Preset to all', { small: true, iconName: 'sparkles', onClick: () => {
      app.world.applyPresetToAll(state.preset && MATERIAL_PRESETS[state.preset] ? state.preset : 'ceramic');
      refreshInspector();
      app.history?.note('Material all', 100);
    } })
  ));

  return section('Appearance', controls, { collapsed: false });
}

function buildToolsSection(rec) {
  const scatterCount = { value: 10 };
  const scatterRadius = { value: 9 };
  const body = el('div', { class: 'stack' },
    el('div', { class: 'btn-row' },
      button('Duplicate', { small: true, iconName: 'copy', onClick: () => app.world.duplicateSelected() }),
      button('Focus', { small: true, iconName: 'focus', onClick: () => app.world.frameSelected() }),
      button('Delete', { small: true, iconName: 'trash', onClick: deleteSelected })
    ),
    section('Scatter', [
      slider({ label: 'Copies', min: 2, max: 40, step: 1, value: 10, precision: 0, onInput: (v) => { scatterCount.value = v; } }),
      slider({ label: 'Radius', min: 1, max: 40, step: 0.5, value: 9, precision: 1, onInput: (v) => { scatterRadius.value = v; } }),
      button('Scatter copies', {
        iconName: 'sparkles',
        variant: 'primary',
        small: true,
        onClick: () => {
          app.world.scatterSelected({ count: Math.round(scatterCount.value), radius: scatterRadius.value });
          app.history?.note('Scatter', 100);
          refreshInspector();
        },
      }),
      hint('Fast way to fill a landscape with rocks, trees or props. Each copy is editable.')
    ], { collapsed: true })
  );
  return section('Object tools', body, { collapsed: true });
}

// ── outliner helpers ─────────────────────────────────────────
function refreshOutlinerSelection(full = false) {
  if (app.activePanel === 'scene') refreshLeft();
  updateSceneCountsInPanels();
}

function updateSceneCountsInPanels() {
  const count = app.world?.records.size || 0;
  const meta = $('#libraryMeta');
  void meta;
  if (app.activePanel === 'scene' || app.activePanel === 'tools') {
    // lightweight count refresh without rebuilding the whole panel
    $$('[data-scene-count]').forEach((n) => { n.textContent = String(count); });
  }
}

// ── menus ────────────────────────────────────────────────────
function menuItem(iconName, title, subtitle, onClick, { danger = false } = {}) {
  const node = el('button', { class: `menu-item${danger ? ' danger' : ''}`, type: 'button' },
    el('div', { class: 'mi-ic' }, icon(iconName)),
    el('div', { class: 'mi-txt' }, el('strong', {}, title), el('span', {}, subtitle))
  );
  node.addEventListener('click', () => { closeModals(); setTimeout(onClick, 80); });
  return node;
}

function renderMenu() {
  const body = $('#menuBody');
  clear(body);
  body.append(
    menuItem('undo', 'Undo', app.history?.canUndo ? 'Step back one edit' : 'Nothing to undo yet', () => app.history?.undo()),
    menuItem('redo', 'Redo', app.history?.canRedo ? 'Step forward again' : 'Nothing to redo', () => app.history?.redo()),
    el('div', { class: 'menu-sep' }),
    menuItem('home', 'World gallery', 'Step into a ready-made world', () => showHome()),
    menuItem('sparkles', 'New blank studio', 'Start with a clean scene', async () => {
      await enterPreset('blank');
    }),
    el('div', { class: 'menu-sep' }),
    menuItem('save', 'Save project', 'Keep everything on this device', () => saveProjectNow()),
    menuItem('folder', 'Open project…', 'Load a .wbox or .json project', () => $('#projectInput').click()),
    menuItem('export', 'Export…', 'GLB, OBJ, project and snapshots', () => { renderExportMenu(); openModal('exportSheet'); }),
    menuItem('camera', 'Shoot mode', 'Frame, grade and capture', () => openPhotoMode()),
    el('div', { class: 'menu-sep' }),
    menuItem('settings', 'Studio settings', 'Performance, smart import, data', () => setPanel('settings')),
    menuItem('help', 'Gestures & shortcuts', 'Learn the controls', () => setPanel('help')),
    menuItem('trash', 'Clear scene', 'Remove every object', async () => {
      if (await confirmDialog('Remove every object in this scene? Your asset library stays intact.', 'Clear scene')) {
        app.world.clear();
        app.history?.note('Clear scene', 50);
        toast('Scene cleared', 'success');
      }
    }, { danger: true }),
    el('div', { class: 'menu-note' }, `Worldbox Studio · ${app.library?.assets.size || 0} assets · created for iPad, desktop and everything glassy.`)
  );
}

function renderExportMenu() {
  const body = $('#exportBody');
  if (!body) return;
  clear(body);
  body.append(
    menuItem('cube', 'Scene as GLB', 'Everything visible, textures embedded', () => exportGLB({ selected: false })),
    menuItem('sphere', 'Selected object as GLB', 'One object, ready for any 3D app', () => exportGLB({ selected: true })),
    menuItem('file', 'Selected object as OBJ', 'Universal geometry exchange', () => exportOBJ({ selected: true })),
    el('div', { class: 'menu-sep' }),
    menuItem('save', 'Portable project (.wbox)', 'Scene + all assets in one file', () => exportPortable()),
    menuItem('file', 'Lightweight project (.json)', 'References assets stored on this device', () => exportProject()),
    el('div', { class: 'menu-sep' }),
    menuItem('camera', 'Snapshot (PNG)', 'Capture the viewport at full resolution', () => downloadSnapshot()),
    menuItem('copy', 'Copy snapshot', 'Put the image on the clipboard', () => copySnapshot()),
    el('div', { class: 'menu-note' }, 'GLB export includes meshes, PBR materials, textures and lights. Use Shoot mode for cinematic captures.')
  );
}

function renderViewMenu() {
  const body = $('#viewBody');
  if (!body) return;
  clear(body);
  const views = [
    ['perspective', 'Perspective', 'Natural three-quarter view'],
    ['front', 'Front', 'Straight on'],
    ['top', 'Top', 'Plan view'],
    ['iso', 'Isometric', 'Clean three-quarter'],
  ];
  for (const [id, title, sub] of views) {
    body.append(menuItem('camera', title, sub, () => { app.engine.cameraPreset(id); toast(`${title} view`, 'success'); }));
  }
  body.append(el('div', { class: 'menu-sep' }));
  body.append(menuItem('focus', 'Frame everything', 'Fit the whole world in view', () => app.world.frameAll()));
  body.append(menuItem('focus', 'Frame selection', 'Fit the selected object', () => app.world.frameSelected()));
  body.append(menuItem('grid', app.settings.showGrid ? 'Hide grid' : 'Show grid', 'Toggle the studio floor grid', () => {
    app.settings.showGrid = !app.settings.showGrid;
    app.engine.grid.visible = app.settings.showGrid;
    saveSettings();
  }));
}

// ── settings ─────────────────────────────────────────────────
export function saveSettings() {
  try { localStorage.setItem('worldbox:settings', JSON.stringify(app.settings)); } catch { /* ignore */ }
}

function applySettingsChange() {
  app.engine?.applyLook(app.project?.environment || {}, app.settings);
  app.engine?.resize();
  app.engine?.setGizmoSnap(app.settings.gizmoSnap);
  app.engine?.setGizmoSpace(app.settings.gizmoSpace);
  app.world?.refreshEnvironment(false);
  app.engine.grid.visible = !!app.settings.showGrid;
  saveSettings();
}

// ── prompts ──────────────────────────────────────────────────
export function promptName(current, onDone) {
  let modal = $('#nameModal');
  if (!modal) {
    modal = el('div', { id: 'nameModal', class: 'modal glass hidden' },
      el('div', { class: 'modal-head' }, el('span', { class: 'panel-kicker' }, 'RENAME'), iconButton('close', () => closeModals())),
      el('div', { class: 'modal-body' },
        el('div', { id: 'nameModalInput' }),
        el('div', { class: 'modal-actions' },
          button('Cancel', { onClick: () => closeModals() }),
          button('Save', { variant: 'primary', onClick: () => {
            const input = $('#nameModalInput input');
            const v = (input?.value || '').trim();
            closeModals();
            if (v) onDone(v);
          } })
        )
      )
    );
    document.body.append(modal);
    modal.querySelector('.modal-head .icon-btn')?.addEventListener('click', closeModals);
  }
  const holder = $('#nameModalInput');
  clear(holder);
  const input = textField({ value: current, onCommit: (v) => { if (v) onDone(v); closeModals(); } });
  holder.append(input);
  openModal('nameModal');
  setTimeout(() => { input.focus(); input.select(); }, 100);
}

export function refreshExportMenus() {
  renderExportMenu();
}

// ── home bridge ──────────────────────────────────────────────
async function enterPreset(id) {
  await app.home?.enter(id);
}
