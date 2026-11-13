import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { app } from './app.js';
import { emit } from './bus.js';
import { storage } from './assets/storage.js';
import { baseName, download, downloadName, prettyName, deepClone, uid } from './core/util.js';
import { toast, showBusy, updateBusy, hideBusy, confirmDialog, openModal, closeModals } from './ui/kit.js';

function sanitize(name) {
  return String(name || 'asset').replace(/[^\w\d\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'asset';
}

function exporterParse(exporter, input, options) {
  return new Promise((resolve, reject) => {
    try {
      exporter.parse(input, resolve, reject, options);
    } catch (e) {
      reject(e);
    }
  });
}

// ── GLB / OBJ ────────────────────────────────────────────────
export async function exportGLB({ selected = false } = {}) {
  const input = selected ? app.world.getSelectedRecord()?.root : app.world.content;
  if (!input) { toast('Select an object first', 'warn'); return; }
  showBusy('Exporting GLB', selected ? 'Packing selected object…' : 'Packing scene…');
  updateBusy('Packing meshes & textures…', 0.4);
  try {
    const exporter = new GLTFExporter();
    const result = await exporterParse(exporter, input, {
      binary: true,
      embedImages: true,
      onlyVisible: true,
      includeCustomExtensions: false,
      maxTextureSize: 4096,
    });
    const blob = result instanceof Blob ? result : new Blob([result], { type: 'model/gltf-binary' });
    const name = selected ? app.world.getSelectedRecord()?.root.name || 'object' : app.project?.name || 'worldbox';
    download(blob, downloadName(name, 'glb'));
    updateBusy('Done', 1);
    toast('GLB exported', 'success');
  } catch (e) {
    console.error('[export glb]', e);
    toast('GLB export failed — try exporting one object', 'err');
  } finally {
    hideBusy();
  }
}

export async function exportOBJ({ selected = true } = {}) {
  const rec = selected ? app.world.getSelectedRecord() : null;
  const input = rec?.root || app.world.content;
  if (!input) { toast('Select an object first', 'warn'); return; }
  try {
    showBusy('Exporting OBJ', 'Writing geometry…');
    const text = new OBJExporter().parse(input);
    const blob = new Blob([text], { type: 'text/plain' });
    download(blob, downloadName(rec?.root.name || app.project?.name || 'scene', 'obj'));
    toast('OBJ exported', 'success');
  } catch (e) {
    console.error('[export obj]', e);
    toast('OBJ export failed', 'err');
  } finally {
    hideBusy();
  }
}

// ── projects ─────────────────────────────────────────────────
export async function saveProjectNow({ silent = false, sync = false } = {}) {
  try {
    const project = app.world.serializeProject({ includeCamera: true });
    app.settings.lastWorld = project.name;
    await storage.saveProject(project);
    if (!silent) toast('Project saved on this device', 'success');
    emit('project:saved', { at: Date.now() });
    void sync;
  } catch (e) {
    console.error('[save]', e);
    if (!silent) toast('Could not save the project', 'err');
  }
}

export async function exportProject() {
  try {
    showBusy('Exporting project', 'Writing scene graph…');
    const project = app.world.serializeProject({ includeCamera: true });
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    download(blob, downloadName(project.name, 'json'));
    toast('Project JSON exported', 'success');
  } catch (e) {
    console.error(e);
    toast('Project export failed', 'err');
  } finally {
    hideBusy();
  }
}

export async function exportPortable() {
  try {
    showBusy('Packaging world', 'Collecting assets…');
    const project = app.world.serializeProject({ includeCamera: true });
    const ids = new Set();
    for (const o of project.objects) {
      if (o.assetId) ids.add(o.assetId);
      for (const m of o.materials || []) {
        for (const id of Object.values(m.maps || {})) {
          if (typeof id === 'string') ids.add(id);
        }
      }
    }
    if (String(app.project?.environment?.background?.type).includes('hdri')) {
      for (const a of app.library.list('env')) ids.add(a.id);
    }
    const manifest = { version: 1, name: project.name, project: 'project.json', assets: [] };
    const zip = new window.JSZip();
    const used = new Map();
    let i = 0;
    for (const id of ids) {
      const asset = app.library.get(id);
      if (!asset) continue;
      const blob = await app.library._blobFor(asset).catch(() => null);
      if (!blob) continue;
      let file = `${sanitize(asset.name)}.${asset.ext || 'bin'}`;
      if (used.has(file)) file = `${sanitize(asset.name)}-${++i}.${asset.ext || 'bin'}`;
      used.set(file, true);
      zip.file(`assets/${file}`, blob);
      manifest.assets.push({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ext: asset.ext || 'bin',
        file: `assets/${file}`,
        meta: { channel: asset.meta?.channel || null },
      });
      updateBusy(`Packing ${asset.name}`, Math.min(0.9, 0.2 + i * 0.1));
    }
    zip.file('project.json', JSON.stringify(project, null, 2));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
    download(blob, downloadName(project.name, 'wbox'));
    toast('Portable world exported', 'success');
  } catch (e) {
    console.error('[portable]', e);
    toast('Portable export failed', 'err');
  } finally {
    hideBusy();
  }
}

export async function openProjectFile(file) {
  if (!file) return;
  const lower = baseName(file.name).toLowerCase();
  try {
    if (lower.endsWith('.json')) {
      const data = JSON.parse(await file.text());
      if (!data?.version || !Array.isArray(data.objects)) throw new Error('Not a Worldbox project');
      showBusy('Opening project', 'Restoring scene…');
      await applyProject(data);
      toast('Project loaded', 'success');
      return;
    }
    if (lower.endsWith('.wbox') || lower.endsWith('.zip')) {
      showBusy('Opening world', 'Reading package…');
      const zip = await window.JSZip.loadAsync(file);
      let project;
      let manifest = null;
      const projectEntry = zip.file('project.json');
      if (!projectEntry) throw new Error('No project.json inside this package');
      project = JSON.parse(await projectEntry.async('text'));
      const manifestEntry = zip.file('manifest.json');
      if (manifestEntry) manifest = JSON.parse(await manifestEntry.async('text'));

      if (manifest?.assets?.length) {
        let i = 0;
        for (const entry of manifest.assets) {
          const zf = zip.file(entry.file);
          if (!zf) { i++; continue; }
          updateBusy(`Restoring ${entry.name}`, 0.1 + (i / manifest.assets.length) * 0.8);
          const blob = await zf.async('blob');
          if (entry.kind === 'texture') {
            await app.library.importTexture({
              name: `${entry.name}.${entry.ext || 'png'}`,
              blob,
              source: { kind: 'single' },
              idOverride: entry.id,
              silent: true,
            });
          } else if (entry.kind === 'env') {
            await app.library.importEnv({
              name: `${entry.name}.${entry.ext || 'hdr'}`,
              blob,
              source: { kind: 'single' },
              idOverride: entry.id,
            });
          } else {
            await app.library.importModel({
              main: { path: `${entry.name}.${entry.ext || 'glb'}`, blob },
              files: [{ path: `${entry.name}.${entry.ext || 'glb'}`, blob }],
              source: { kind: 'single' },
              candidates: [],
              smart: false,
              idOverride: entry.id,
              displayName: entry.name,
            });
          }
          i++;
        }
      }
      await applyProject(project);
      toast('World loaded', 'success');
      return;
    }
    toast('That file is not a project', 'warn');
  } catch (e) {
    console.error('[project import]', e);
    toast(`Could not open project: ${e.message || e}`, 'err');
  } finally {
    hideBusy();
  }
}

async function applyProject(project) {
  closeModals();
  await app.world.loadProject(project);
  app.project = project;
  app.history?.reset();
  app.ui?.enterEditor();
  app.ui?.refreshAll();
  emit('project:loaded', project);
  try { localStorage.setItem('worldbox:name', project.name || 'Untitled World'); } catch { /* ignore */ }
}

export function initProjectFileInput() {
  const input = document.getElementById('projectInput');
  input?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) openProjectFile(file);
    e.target.value = '';
  });
}

// ── snapshots ────────────────────────────────────────────────
export function downloadSnapshot() {
  try {
    const dataUrl = app.engine.captureDataURL(2, 4096);
    if (!dataUrl) throw new Error('capture failed');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = downloadName(`${app.project?.name || 'worldbox'}-${stamp()}`, 'png');
    document.body.append(a);
    a.click();
    a.remove();
    toast('Snapshot saved', 'success');
  } catch (e) {
    console.error(e);
    toast('Could not capture the viewport', 'err');
  }
}

export async function copySnapshot() {
  try {
    const dataUrl = app.engine.captureDataURL(1.5, 3000);
    const blob = await (await fetch(dataUrl)).blob();
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('Clipboard unsupported');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Snapshot copied', 'success');
  } catch (e) {
    console.warn(e);
    toast('Clipboard is not available in this browser', 'warn');
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
