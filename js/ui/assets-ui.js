import { app } from '../app.js';
import { emit, on } from '../bus.js';
import { formatBytes, fileExt, baseName, download, downloadName, clamp } from '../core/util.js';
import {
  $, $$, el, icon, toast, openSheet, closeSheets, openModal, closeModals, confirmDialog,
  showBusy, updateBusy, hideBusy, button, iconButton, emptyState, haptic,
} from './kit.js';

let libraryTab = 'all';
let query = '';
let pickerCallback = null;
let pickerSlot = null;
let dragState = null;
let dragDepth = 0;
let importing = false;

export function initAssetsUI() {
  const openLibrary = () => {
    openSheet('librarySheet');
    refreshLibrary();
  };

  ['#dockUpload', '#libraryUpload', '#pickFiles'].forEach((sel) => {
    $(sel)?.addEventListener('click', () => $('#fileInput').click());
  });
  $('#pickZip')?.addEventListener('click', () => $('#zipInput').click());
  $('#dockExpand')?.addEventListener('click', openLibrary);
  $('#assetsTopBtn')?.addEventListener('click', openLibrary);

  $('#fileInput')?.addEventListener('change', (e) => {
    if (e.target.files?.length) importAndPlace(e.target.files);
    e.target.value = '';
  });
  $('#zipInput')?.addEventListener('change', (e) => {
    if (e.target.files?.length) importAndPlace(e.target.files);
    e.target.value = '';
  });

  $('#assetSearch')?.addEventListener('input', (e) => {
    query = e.target.value.trim().toLowerCase();
    refreshLibrary();
  });

  $$('#libraryTabs [data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'photo') {
        closeSheets();
        app.photo?.openGallery();
        return;
      }
      libraryTab = tab;
      $$('#libraryTabs [data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      refreshLibrary();
    });
  });

  $$('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheets));
  $('#sheetBackdrop')?.addEventListener('click', () => {
    closeSheets();
    app.photo?.closeViewer();
  });

  setupOSDrop();
  setupWindowDrag();

  on('assets:changed', () => {
    refreshDock();
    refreshLibrary();
    refreshMeta();
  });
  on('import:progress', (p) => {
    if (p.active) {
      showBusy('Importing', p.label || 'Working…');
      updateBusy(p.label, p.value);
    } else {
      hideBusy();
    }
  });

  refreshDock();
  refreshLibrary();
  refreshMeta();
}

export function importAndPlace(files) {
  if (importing) return;
  importing = true;
  const list = [...files];
  if (!list.length) { importing = false; return; }
  showBusy('Importing', list.length === 1 ? list[0].name : `${list.length} files`);
  app.library.importFiles(list, { origin: 'ui' })
    .then(({ added }) => afterImport(added))
    .catch((err) => {
      console.error(err);
      toast('Import failed — see console', 'err');
    })
    .finally(() => {
      importing = false;
      hideBusy();
      refreshDock();
      refreshLibrary();
      refreshMeta();
    });
}

async function afterImport(added = []) {
  if (!added.length) return;
  const models = added.filter((a) => a.kind === 'model');
  const textures = added.filter((a) => a.kind === 'texture');
  const envs = added.filter((a) => a.kind === 'env');

  if (models.length) {
    const asset = models[0];
    try { await app.library.ensureTemplate(asset.id); } catch { /* ignore */ }
    if (app.library.templates.has(asset.id)) {
      app.world.addAsset(asset.id);
      setTimeout(() => app.world.frameSelected(), 80);
    }
    if (models.length > 1) toast(`${models.length} models added to the library`, 'success');
    else toast(`${asset.name} added to the scene`, 'success');
  }
  if (textures.length) {
    toast(`${textures.length} texture${textures.length > 1 ? 's' : ''} added${app.settings.smartTextures ? ' · smart match on' : ''}`, 'success');
  }
  if (envs.length) {
    await applyEnvAsset(envs[0].id, { silent: false });
  }
}

function setupOSDrop() {
  const veil = $('#dropVeil');
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    veil?.classList.add('active');
  });
  window.addEventListener('dragover', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const zone = $('#libraryDrop');
    if (zone) zone.classList.add('dragover');
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      veil?.classList.remove('active');
      $('#libraryDrop')?.classList.remove('dragover');
    }
  });
  window.addEventListener('drop', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    veil?.classList.remove('active');
    $('#libraryDrop')?.classList.remove('dragover');
    if (e.dataTransfer.files?.length) importAndPlace(e.dataTransfer.files);
  });
}

function setupWindowDrag() {
  window.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.active && Math.hypot(dx, dy) > 7) {
      dragState.active = true;
      startGhost(e);
    }
    if (!dragState.active) return;
    e.preventDefault();
    dragState.ghost.style.left = `${e.clientX}px`;
    dragState.ghost.style.top = `${e.clientY}px`;
    updateDragHover(e);
  }, { passive: false });

  const finish = (e, cancelled = false) => {
    if (!dragState) return;
    const state = dragState;
    dragState = null;
    app.flags.draggingAsset = null;
    state.ghost?.remove();
    app.engine?.hideHover();
    $('#viewport')?.classList.remove('dropping');
    if (!state.active) {
      if (!cancelled) useAsset(state.assetId);
      return;
    }
    if (!cancelled) handleDrop(e, state.assetId);
  };
  window.addEventListener('pointerup', (e) => finish(e, false));
  window.addEventListener('pointercancel', (e) => finish(e, true));
}

function startGhost(e) {
  const asset = app.library.get(dragState.assetId);
  if (!asset) return;
  const ghost = el('div', { class: `drag-ghost${asset.kind === 'texture' ? ' tex' : ''}` });
  if (asset.thumb) ghost.append(el('img', { src: asset.thumb, alt: '' }));
  else ghost.append(icon(asset.kind === 'env' ? 'globe' : 'cube', 'ic'));
  ghost.style.left = `${e.clientX}px`;
  ghost.style.top = `${e.clientY}px`;
  document.body.append(ghost);
  dragState.ghost = ghost;
  app.flags.draggingAsset = asset;
  haptic(6);
}

function updateDragHover(e) {
  const asset = app.library.get(dragState.assetId);
  if (!asset || asset.kind !== 'texture') return;
  const overCanvas = isOverViewport(e.clientX, e.clientY);
  $('#viewport').classList.toggle('dropping', overCanvas);
  if (!overCanvas) {
    app.engine.showHover(null);
    return;
  }
  const rec = app.world.pickRecord(e.clientX, e.clientY);
  app.engine.showHover(rec?.root || null);
}

function isOverViewport(x, y) {
  const target = document.elementFromPoint(x, y);
  return target && (target.id === 'viewport' || target.id === 'viewportShade' || target.closest?.('#viewport'));
}

function bindDrag(node, assetId) {
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.asset-actions, .icon-only, .slot-x')) return;
    dragState = { assetId, startX: e.clientX, startY: e.clientY, active: false, ghost: null };
  });
}

async function handleDrop(e, assetId) {
  const asset = app.library.get(assetId);
  if (!asset) return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const slotEl = target?.closest?.('[data-tex-slot]');
  if (slotEl && asset.kind === 'texture') {
    await app.library.ensureTexture(assetId).catch(() => null);
    app.world.setTextureOnMaterial(slotEl.dataset.texSlot, assetId);
    toast(`${asset.name} → ${slotEl.dataset.texSlot}`, 'success');
    return;
  }
  if (!isOverViewport(e.clientX, e.clientY)) return;

  if (asset.kind === 'model') {
    const pt = app.world.pointOnGround(e.clientX, e.clientY);
    const surface = app.world.pickSurface?.(e.clientX, e.clientY);
    try { await app.library.ensureTemplate(assetId); } catch { /* ignore */ }
    if (!app.library.templates.has(assetId)) { toast('Model could not be loaded', 'err'); return; }
    app.world.addAsset(assetId, { at: surface?.point || pt, surface: surface?.point || null });
    toast(surface ? `${asset.name} placed on ${surface.record?.root?.name || 'surface'}` : `${asset.name} placed`, 'success');
    haptic(12);
    return;
  }
  if (asset.kind === 'texture') {
    await app.library.ensureTexture(assetId).catch(() => null);
    if (!app.library.textures.has(assetId)) { toast('Texture could not be read', 'err'); return; }
    const rec = app.world.pickRecord(e.clientX, e.clientY) || app.world.getSelectedRecord();
    if (!rec) { toast('Drop it on a model, or select one first', 'warn'); return; }
    const n = app.world.applyTextureToRecord(rec, assetId);
    if (app.selection === rec.id) app.ui?.refreshInspector();
    toast(n ? `Texture applied to ${rec.root.name}` : 'No compatible material slot', n ? 'success' : 'warn');
    haptic(10);
    return;
  }
  if (asset.kind === 'env') {
    await applyEnvAsset(assetId);
  }
}

export async function useAsset(assetId) {
  const asset = app.library.get(assetId);
  if (!asset) return;
  if (asset.kind === 'model') {
    try { await app.library.ensureTemplate(assetId); } catch { /* ignore */ }
    if (!app.library.templates.has(assetId)) { toast('That model could not be loaded', 'err'); return; }
    app.world.addAsset(assetId);
    haptic(12);
    toast(`${asset.name} added`, 'success');
  } else if (asset.kind === 'texture') {
    await app.world.applyTextureAssetToSelected(assetId);
  } else if (asset.kind === 'env') {
    await applyEnvAsset(assetId);
  }
}

async function applyEnvAsset(assetId, { silent = false } = {}) {
  const asset = app.library.get(assetId);
  if (!asset) return;
  const tex = await app.library.ensureEnvTexture(assetId);
  if (!tex) return;
  app.world.env.setHDRI(tex);
  app.project.environment.background = { type: 'hdri', name: asset.name };
  app.world.engine.applyLook(app.project.environment, app.settings);
  app.history?.note('Environment');
  emit('environment:changed');
  toast(`Environment: ${asset.name}`, 'success');
  if (!silent) haptic(10);
}

// ── dock ─────────────────────────────────────────────────────
export function refreshDock() {
  const wrap = $('#dockItems');
  if (!wrap) return;
  const list = app.library ? app.library.list('all').slice(0, 40) : [];
  wrap.replaceChildren();
  $('#assetCount').textContent = String(app.library ? app.library.assets.size : 0);
  if (!list.length) {
    wrap.append(el('div', { class: 'dock-empty' }, 'Your assets live here — drop files anywhere, or tap Import.'));
    return;
  }
  for (const asset of list) {
    const item = el('button', {
      class: `dock-item ${asset.kind}`,
      title: `${asset.name} · ${asset.kind}`,
      type: 'button',
    });
    if (asset.thumb) item.append(el('img', { src: asset.thumb, alt: '', draggable: 'false' }));
    else item.append(el('div', { class: 'dock-glyph' }, icon(asset.kind === 'env' ? 'globe' : asset.kind === 'texture' ? 'image' : 'cube')));
    item.append(el('span', { class: 'dock-badge' }, asset.kind === 'model' ? '3D' : asset.kind === 'texture' ? 'TEX' : 'HDRI'));
    bindDrag(item, asset.id);
    wrap.append(item);
  }
}

// ── library sheet ────────────────────────────────────────────
export function refreshLibrary() {
  const grid = $('#assetGrid');
  if (!grid) return;
  let list = app.library ? app.library.list(libraryTab === 'all' ? 'all' : libraryTab) : [];
  if (query) {
    list = list.filter((a) => a.name.toLowerCase().includes(query) || (a.meta?.filename || '').toLowerCase().includes(query));
  }
  grid.replaceChildren();
  $('#libraryEmpty')?.classList.toggle('hidden', list.length > 0);
  if (!list.length) {
    $('#libraryEmpty').textContent = query
      ? 'No assets match that search.'
      : 'No assets yet — import a model, a texture or a ZIP folder to begin.';
  }
  const frag = document.createDocumentFragment();
  for (const asset of list) {
    frag.append(assetCard(asset));
  }
  grid.append(frag);
}

function assetCard(asset) {
  const card = el('article', { class: `asset-card ${asset.kind}`, dataset: { id: asset.id } });
  const thumb = el('div', { class: `asset-thumb ${asset.kind === 'texture' ? 'tex' : ''} ${asset.kind === 'env' ? 'env' : ''}` });
  if (asset.thumb) thumb.append(el('img', { src: asset.thumb, alt: '', draggable: 'false' }));
  else {
    thumb.append(el('div', { class: 'dock-glyph' }, icon(asset.kind === 'env' ? 'globe' : 'cube'),));
  }
  thumb.append(el('span', { class: 'kind-badge' }, asset.kind === 'model' ? asset.ext || '3D' : asset.kind === 'texture' ? 'Texture' : 'HDRI'));
  const meta = asset.kind === 'model'
    ? `${((asset.meta?.triangles || 0) / 1000).toFixed(1)}k tris · ${formatBytes(asset.size)}`
    : asset.kind === 'texture'
      ? `${asset.meta?.width || '—'}×${asset.meta?.height || '—'} · ${formatBytes(asset.size)}`
      : `HDR environment · ${formatBytes(asset.size)}`;

  const info = el('div', { class: 'asset-info' },
    el('strong', { title: asset.name }, asset.name),
    el('span', {}, meta)
  );
  const actions = el('div', { class: 'asset-actions' },
    el('button', {
      type: 'button',
      class: 'icon-only',
      title: 'Download original',
      onclick: (e) => { e.stopPropagation(); downloadAsset(asset.id); },
    }, icon('download')),
    el('button', {
      type: 'button',
      class: 'icon-only',
      title: 'Delete asset',
      onclick: (e) => { e.stopPropagation(); removeAsset(asset.id); },
    }, icon('trash'))
  );
  card.append(thumb, info, actions);
  bindDrag(card, asset.id);
  card.addEventListener('dblclick', () => useAsset(asset.id));
  return card;
}

async function removeAsset(id) {
  const asset = app.library.get(id);
  if (!asset) return;
  const used = [...app.world.records.values()].filter((r) => r.desc.assetId === id);
  const text = used.length
    ? `Delete “${asset.name}”? ${used.length} object${used.length > 1 ? 's' : ''} in the scene use it and will be removed.`
    : `Delete “${asset.name}” from your library?`;
  const ok = await confirmDialog(text);
  if (!ok) return;
  for (const r of used) app.world.removeRecord(r.id);
  await app.library.deleteAsset(id);
  app.history?.note('Delete asset', 50);
  refreshDock();
  refreshLibrary();
  refreshMeta();
  toast('Asset deleted', 'success');
}

async function downloadAsset(id) {
  const asset = app.library.get(id);
  if (!asset) return;
  const blob = await app.library._blobFor(asset).catch(() => null);
  if (!blob) { toast('Original file is not stored', 'warn'); return; }
  download(blob, `${asset.name.replace(/[^\w\- ]+/g, '')}.${asset.ext || 'bin'}`);
}

async function refreshMeta() {
  const node = $('#libraryMeta');
  if (!node) return;
  const count = app.library ? app.library.assets.size : 0;
  let storageText = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) storageText = ` · ${formatBytes(est.usage)} stored`;
  } catch { /* ignore */ }
  node.textContent = `${count} asset${count === 1 ? '' : 's'}${storageText}`;
}

// ── texture picker ───────────────────────────────────────────
export function openTexturePicker(slot, callback = null) {
  pickerSlot = slot;
  pickerCallback = callback;
  let modal = $('#texturePicker');
  if (!modal) {
    modal = el('div', { id: 'texturePicker', class: 'modal glass hidden' },
      el('div', { class: 'modal-head' },
        el('span', { class: 'panel-kicker' }, 'TEXTURE'),
        iconButton('close', () => closeModal('texturePicker'), { cls: 'icon-btn' })
      ),
      el('div', { class: 'modal-body' },
        el('p', {}, 'Pick a texture from your library, or drag one straight onto a slot.'),
        el('div', { id: 'texturePickerGrid', class: 'picker-grid' })
      )
    );
    document.body.append(modal);
  }
  const grid = modal.querySelector('#texturePickerGrid');
  grid.replaceChildren();
  const textures = app.library.list('texture');
  if (!textures.length) {
    grid.append(el('div', { class: 'picker-empty' },
      el('span', {}, 'No textures imported yet.'),
      button('Import textures', { iconName: 'upload', variant: 'primary', onClick: () => { closeModal('texturePicker'); $('#fileInput').click(); } })
    ));
  } else {
    for (const t of textures) {
      const chip = el('button', { class: 'picker-item', type: 'button', title: t.name },
        t.thumb ? el('img', { src: t.thumb, alt: '' }) : el('div', { class: 'picker-glyph' }, icon('image')),
        el('span', {}, t.name)
      );
      chip.addEventListener('click', async () => {
        await app.library.ensureTexture(t.id).catch(() => null);
        closeModal('texturePicker');
        if (pickerCallback) pickerCallback(t.id);
        else if (pickerSlot) app.world.setTextureOnMaterial(pickerSlot, t.id);
      });
      grid.append(chip);
    }
    grid.append(el('button', { class: 'picker-item add', type: 'button' },
      el('div', { class: 'picker-glyph' }, icon('plus')),
      el('span', {}, 'Import more')
    ));
    grid.querySelector('.picker-item.add').addEventListener('click', () => {
      closeModal('texturePicker');
      $('#fileInput').click();
    });
  }
  openModal('texturePicker');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  closeModals();
  if (id && id !== 'texturePicker') document.getElementById(id)?.classList.add('hidden');
}
