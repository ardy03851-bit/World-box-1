import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { storage } from './storage.js';
import { app } from '../app.js';
import { emit } from '../bus.js';
import {
  uid, fileExt, baseName, prettyName, formatBytes, sleep,
} from '../core/util.js';
import { collectMaterials, TEXTURE_SLOTS } from '../core/materials.js';
import { normalizeAsset } from '../core/objects.js';
import { detectChannel, matchTextures, applyTextureToSlot } from './textures.js';

const MODEL_EXT = new Set(['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif', 'ktx2']);
const ENV_EXT = new Set(['hdr', 'exr']);
const SUPPORTED = new Set([...MODEL_EXT, ...IMAGE_EXT, ...ENV_EXT, 'zip', 'wbox', 'bin', 'mtl']);

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp',
  avif: 'image/avif', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
  hdr: 'application/octet-stream', exr: 'application/octet-stream', obj: 'text/plain', mtl: 'text/plain',
  fbx: 'application/octet-stream', stl: 'application/octet-stream', ply: 'application/octet-stream',
};

const blobUrlMap = new Map(); // bundle id -> [urls]

function isModel(name) {
  return MODEL_EXT.has(fileExt(name));
}
function isImage(name) {
  return IMAGE_EXT.has(fileExt(name));
}
function isEnv(name) {
  return ENV_EXT.has(fileExt(name));
}

export class Library {
  constructor() {
    this.assets = new Map();
    this.templates = new Map();
    this.textures = new Map();
    this.envTextures = new Map();
    this.clips = new Map();
    this.loading = new Map();
    this.archives = new Map();
    this.batches = new Map();
    this.pendingBlobs = new Map();
    this.ready = false;
    this.progress = { active: false, label: '', value: 0 };
  }

  async init() {
    try {
      const records = await storage.listAssets();
      for (const rec of records) {
        if (rec?.id) this.assets.set(rec.id, rec);
      }
    } catch (e) {
      console.warn('[library] failed to read assets', e);
    }
    this.ready = true;
    emit('assets:changed');
    return this;
  }

  list(kind = 'all') {
    const all = [...this.assets.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (kind === 'all') return all;
    return all.filter((a) => a.kind === kind);
  }

  get(id) {
    return this.assets.get(id) || null;
  }

  uniqueName(name) {
    const base = name || 'Asset';
    const existing = new Set([...this.assets.values()].map((a) => a.name.toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    let i = 2;
    while (existing.has(`${base} ${i}`.toLowerCase())) i++;
    return `${base} ${i}`;
  }

  setProgress(label, value) {
    this.progress = { active: value > 0 && value < 1, label, value };
    emit('import:progress', this.progress);
  }

  // ══════════════════ importing ══════════════════
  async importFiles(fileList, { origin = 'upload' } = {}) {
    const entries = [...fileList]
      .filter((f) => f && typeof f.size === 'number')
      .map((f) => ({ file: f, path: f.webkitRelativePath || f.name || 'file' }));

    if (!entries.length) return { added: [] };
    const added = [];
    const projects = entries.filter((e) => fileExt(e.path) === 'wbox');
    const zips = entries.filter((e) => fileExt(e.path) === 'zip');
    const others = entries.filter((e) => !zips.includes(e) && !projects.includes(e));

    this.setProgress('Preparing import…', 0.04);
    try {
      for (const p of projects) {
        emit('project:import-file', p.file);
      }
      for (const z of zips) {
        const res = await this.importZip(z.file);
        added.push(...res);
      }
      const models = others.filter((e) => isModel(e.path));
      const images = others.filter((e) => isImage(e.path));
      const envs = others.filter((e) => isEnv(e.path));
      const unsupported = others.filter((e) => !isModel(e.path) && !isImage(e.path) && !isEnv(e.path) && !['bin', 'mtl'].includes(fileExt(e.path)));

      if (models.length === 1) {
        const ctx = await this._makeUploadContext(others);
        // register textures first so smart match has candidates
        const newTextures = [];
        for (const img of images) {
          const tex = await this.importTexture({
            name: img.path,
            blob: img.file,
            source: ctx.sourceFor(img.path, img.file),
            silent: true,
          });
          if (tex) newTextures.push(tex);
        }
        for (const env of envs) {
          const a = await this.importEnv({ name: env.path, blob: env.file, source: ctx.sourceFor(env.path, env.file) });
          if (a) added.push(a);
        }
        const asset = await this.importModel({
          main: { path: models[0].path, blob: models[0].file },
          files: others,
          source: ctx.sourceFor(models[0].path, models[0].file),
          candidates: [...newTextures, ...this.list('texture')],
        });
        if (asset) added.push(asset);
        added.push(...newTextures);
      } else if (models.length > 1) {
        const ctx = await this._makeUploadContext(others);
        const newTextures = [];
        for (const img of images) {
          const t = await this.importTexture({ name: img.path, blob: img.file, source: ctx.sourceFor(img.path, img.file), silent: true });
          if (t) newTextures.push(t);
        }
        for (const env of envs) {
          const a = await this.importEnv({ name: env.path, blob: env.file, source: ctx.sourceFor(env.path, env.file) });
          if (a) added.push(a);
        }
        let i = 0;
        for (const m of models) {
          this.setProgress(`Importing ${prettyName(m.path)}…`, 0.1 + (i / models.length) * 0.8);
          const asset = await this.importModel({
            main: { path: m.path, blob: m.file },
            files: others,
            source: ctx.sourceFor(m.path, m.file),
            candidates: [...newTextures, ...this.list('texture')],
          });
          if (asset) added.push(asset);
          i++;
        }
        added.push(...newTextures);
      } else {
        for (let i = 0; i < images.length; i++) {
          this.setProgress('Reading textures…', 0.1 + (i / images.length) * 0.7);
          const t = await this.importTexture({
            name: images[i].path,
            blob: images[i].file,
            source: { kind: 'single' },
          });
          if (t) added.push(t);
        }
        for (const env of envs) {
          const a = await this.importEnv({ name: env.path, blob: env.file, source: { kind: 'single' } });
          if (a) added.push(a);
        }
      }

      if (!added.length && !projects.length) {
        emit('toast', { text: unsupported.length ? 'That file type is not supported yet' : 'Nothing new to import', type: 'warn' });
      } else if (unsupported.length) {
        emit('toast', { text: `Skipped ${unsupported.length} unsupported file${unsupported.length > 1 ? 's' : ''}`, type: 'warn' });
      }
    } catch (err) {
      console.error('[import]', err);
      emit('toast', { text: err?.message ? `Import failed: ${err.message}` : 'Import failed', type: 'err' });
    } finally {
      this.setProgress('', 1);
      emit('assets:changed');
    }
    return { added };
  }

  async _makeUploadContext(entries) {
    const hasExtras = entries.length > 1;
    let batchId = null;
    if (hasExtras) {
      batchId = uid('batch');
      const manifest = { files: [] };
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const key = `${batchId}:${i}`;
        this.pendingBlobs.set(key, e.file);
        await storage.putFile(key, { blob: e.file, name: e.path });
        manifest.files.push({ path: e.path, key });
      }
      this.batches.set(batchId, entries.map((e) => ({ path: e.path, blob: e.file })));
      await storage.putFile(batchId, { manifest });
    }
    return {
      sourceFor: (path, file) => (batchId ? { kind: 'batch', batchId, path } : { kind: 'single' }),
    };
  }

  async importZip(file) {
    const added = [];
    const zip = await window.JSZip.loadAsync(file);
    const archiveId = uid('zip');
    this.setProgress(`Unzipping ${file.name}…`, 0.12);
    await storage.putFile(archiveId, { blob: file, name: file.name });

    const allFiles = [];
    const paths = Object.keys(zip.files);
    for (const path of paths) {
      const entry = zip.files[path];
      if (!entry || entry.dir) continue;
      if (path.includes('__MACOSX') || baseName(path).startsWith('.')) continue;
      const ext = fileExt(path);
      if (!ext || !SUPPORTED.has(ext)) continue;
      const blob = await entry.async('blob');
      const typed = blob.type ? blob : blob.slice(0, blob.size, MIME[ext] || 'application/octet-stream');
      allFiles.push({ path, blob: typed, ext });
    }
    this.archives.set(archiveId, allFiles.map((f) => ({ path: f.path, blob: f.blob })));

    if (!allFiles.length) {
      emit('toast', { text: 'That ZIP has no supported files', type: 'warn' });
      return added;
    }

    const projectJson = allFiles.find((f) => /(^|\/)(project|world|scene)\.json$/i.test(f.path) || f.ext === 'wbox');
    if (projectJson) {
      try {
        const text = await projectJson.blob.text();
        const data = JSON.parse(text);
        if (data?.version && (data.objects || data.environment)) {
          emit('project:import-data', data);
        }
      } catch { /* not a project */ }
    }

    // 1. register the images as reusable texture assets
    const imageFiles = allFiles.filter((f) => isImage(f.path));
    const newTextures = [];
    for (let i = 0; i < imageFiles.length; i++) {
      this.setProgress(`Reading textures ${i + 1}/${imageFiles.length}…`, 0.15 + (i / Math.max(1, imageFiles.length)) * 0.3);
      const t = await this.importTexture({
        name: imageFiles[i].path,
        blob: imageFiles[i].blob,
        source: { kind: 'zip', archiveId, path: imageFiles[i].path },
        silent: true,
      });
      if (t) newTextures.push(t);
    }
    added.push(...newTextures);

    // 2. environments
    for (const f of allFiles.filter((x) => isEnv(x.path))) {
      const a = await this.importEnv({
        name: f.path,
        blob: f.blob,
        source: { kind: 'zip', archiveId, path: f.path },
      });
      if (a) added.push(a);
    }

    // 3. models
    const models = allFiles.filter((f) => isModel(f.path));
    let i = 0;
    for (const m of models) {
      this.setProgress(`Importing ${prettyName(m.path)}…`, 0.5 + (i / Math.max(1, models.length)) * 0.45);
      const asset = await this.importModel({
        main: { path: m.path, blob: m.blob },
        files: allFiles,
        source: { kind: 'zip', archiveId, path: m.path },
        candidates: [...newTextures, ...this.list('texture')],
      });
      if (asset) added.push(asset);
      i++;
    }

    if (!models.length) {
      emit('toast', { text: `Found ${imageFiles.length} texture${imageFiles.length === 1 ? '' : 's'} — no 3D model`, type: 'info' });
    } else {
      emit('toast', { text: `Imported ${models.length} model${models.length > 1 ? 's' : ''}${newTextures.length ? ` + ${newTextures.length} textures` : ''}`, type: 'success' });
    }
    return added;
  }

  _buildBundle(files, mainPath) {
    const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
    const map = new Map();
    const byBase = new Map();
    const list = [];
    for (const f of files) {
      if (!f) continue;
      const path = f.path || f.file?.name || '';
      const blob = f.blob || f.file;
      if (!blob) continue;
      const key = norm(path);
      if (!map.has(key)) map.set(key, blob);
      const b = norm(baseName(path));
      if (!byBase.has(b)) byBase.set(b, blob);
      list.push({ path, blob });
    }
    const main = list.find((f) => norm(f.path) === norm(mainPath)) || list[0];
    const urls = [];
    const urlFor = (blob) => {
      const u = URL.createObjectURL(blob);
      urls.push(u);
      return u;
    };
    const bundle = {
      map, byBase, list, main, urls,
      mainName: main?.path || mainPath || 'model',
      mainBlob: main?.blob,
    };
    return bundle;
  }

  _managerFor(bundle) {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (!url) return url;
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      let clean = url;
      try { clean = decodeURIComponent(url); } catch { /* ignore */ }
      clean = clean.split('?')[0].split('#')[0];
      if (clean.startsWith('http://') || clean.startsWith('https://')) {
        try { clean = new URL(clean).pathname; } catch { /* ignore */ }
      }
      const key = clean.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
      const b = key.split('/').pop();
      let blob = bundle.map.get(key) || bundle.map.get(b) || bundle.byBase.get(b);
      if (!blob) {
        const stem = b.replace(/\.[a-z0-9]+$/, '');
        for (const [name, value] of bundle.byBase) {
          if (name.replace(/\.[a-z0-9]+$/, '') === stem) { blob = value; break; }
        }
      }
      if (blob) return bundle.urls.push(URL.createObjectURL(blob)), bundle.urls[bundle.urls.length - 1];
      return url;
    });
    return manager;
  }

  async _parseModel(bundle) {
    const ext = fileExt(bundle.mainName);
    const blob = bundle.mainBlob;
    if (!blob) throw new Error('Missing model file');
    const manager = this._managerFor(bundle);
    const waiter = createLoadWaiter(manager);
    const waitForTextures = () => waiter.wait(2500);
    const cleanup = () => setTimeout(() => {
      for (const u of bundle.urls) URL.revokeObjectURL(u);
      bundle.urls.length = 0;
    }, 8000);
    try {
      return await this._parseWith(ext, blob, bundle, manager, waitForTextures);
    } finally {
      cleanup();
    }
  }

  async _parseWith(ext, blob, bundle, manager, waitForTextures) {

    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader(manager);
      const draco = new DRACOLoader(manager);
      draco.setDecoderPath('./vendor/three/addons/draco/gltf/');
      loader.setDRACOLoader(draco);
      loader.setMeshoptDecoder(MeshoptDecoder);
      const data = ext === 'glb' ? await blob.arrayBuffer() : await blob.text();
      const gltf = await new Promise((resolve, reject) => {
        loader.parse(data, '', resolve, reject);
      });
      const object = gltf.scene || gltf.scenes?.[0];
      if (!object) throw new Error('Model has no scene');
      object.userData.gltf = { asset: gltf.asset };
      return { object, animations: gltf.animations || [] };
    }

    if (ext === 'fbx') {
      const loader = new FBXLoader(manager);
      const buffer = await blob.arrayBuffer();
      const obj = loader.parse(buffer, '');
      await waitForTextures();
      return { object: obj, animations: obj.animations || [] };
    }

    if (ext === 'obj') {
      const objLoader = new OBJLoader(manager);
      const text = await blob.text();
      // find a matching .mtl
      const mtlEntry = bundle.list.find((f) => fileExt(f.path) === 'mtl' && baseName(f.path).toLowerCase().startsWith(baseName(bundle.mainName).replace(/\.obj$/i, '').toLowerCase()));
      if (mtlEntry) {
        try {
          const mtlLoader = new MTLLoader(manager);
          const materials = mtlLoader.parse(await mtlEntry.blob.text(), '');
          materials.preload();
          objLoader.setMaterials(materials);
        } catch (e) {
          console.warn('[obj] mtl failed', e);
        }
      }
      const group = objLoader.parse(text);
      await waitForTextures();
      return { object: group, animations: [] };
    }

    if (ext === 'stl') {
      const geo = new STLLoader(manager).parse(await blob.arrayBuffer());
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.1, roughness: 0.45 });
      return { object: new THREE.Mesh(geo, mat), animations: [] };
    }

    if (ext === 'ply') {
      const geo = new PLYLoader(manager).parse(await blob.arrayBuffer());
      geo.computeVertexNormals();
      const hasColor = !!geo.attributes.color;
      const mat = new THREE.MeshStandardMaterial({ color: hasColor ? 0xffffff : 0xbfc3cc, vertexColors: hasColor, metalness: 0.05, roughness: 0.6, flatShading: false });
      return { object: new THREE.Mesh(geo, mat), animations: [] };
    }

    throw new Error(`Unsupported model: ${ext}`);
  }

  async importModel({ main, files, source, candidates = [], displayName = null, idOverride = null, smart = true }) {
    const bundle = this._buildBundle(files?.length ? files : [{ path: main.path, blob: main.blob }], main.path);
    let parsed;
    try {
      parsed = await this._parseModel(bundle);
    } catch (err) {
      console.error('[model] parse failed', err);
      emit('toast', { text: `Could not read ${prettyName(main.path)}`, type: 'err' });
      return null;
    }
    const id = idOverride || uid('model');
    const object = parsed.object;
    object.updateMatrixWorld(true);
    object.name = displayName || prettyName(main.path);

    if (app.settings?.autoScale) {
      try { normalizeAsset(object, 2.2); } catch { /* ignore */ }
    }
    object.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            if (!m) return;
            if (m.name === '') m.name = o.name || 'Material';
            m.envMapIntensity = m.envMapIntensity ?? 1;
          });
        }
      }
    });

    // smart textures first, so the thumbnail shows them
    let matched = 0;
    if (smart) {
      try {
        matched = await this.smartMatch(object, object.name, candidates);
      } catch (e) {
        console.warn('[smart]', e);
      }
    }

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    let triangles = 0;
    let meshes = 0;
    const materialNames = new Set();
    object.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        meshes++;
        const g = o.geometry;
        if (g) triangles += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m && materialNames.add(m.name || 'Material'));
      }
    });

    let thumb = '';
    try {
      thumb = app.engine?.thumbnail(object, { size: 320 }) || '';
    } catch (e) {
      console.warn('[thumb]', e);
    }

    const record = {
      id,
      name: idOverride ? object.name : this.uniqueName(object.name),
      kind: 'model',
      ext: fileExt(main.path),
      size: (files || []).reduce((n, f) => n + (f.blob?.size || f.file?.size || 0), 0),
      createdAt: Date.now(),
      thumb,
      source,
      meta: {
        triangles: Math.round(triangles),
        meshes,
        materials: [...materialNames],
        animations: parsed.animations.length,
        bbox: [size.x, size.y, size.z].map((n) => Math.round(n * 100) / 100),
        autoTextures: matched,
      },
    };
    object.name = record.name;

    await storage.putAsset(record);
    if (source.kind === 'single') {
      await storage.putFile(id, { blob: main.blob, name: main.path });
      this.pendingBlobs.set(id, main.blob);
    }

    this.templates.set(id, object);
    if (parsed.animations.length) this.clips.set(id, parsed.animations);
    this.assets.set(id, record);
    emit('assets:changed');
    emit('asset:added', record);
    if (matched > 0) {
      emit('toast', { text: `Smart-matched ${matched} texture${matched > 1 ? 's' : ''} on ${record.name}`, type: 'success' });
    }
    return record;
  }

  async importTexture({ name, blob, source = { kind: 'single' }, silent = false, idOverride = null }) {
    if (!blob) return null;
    const id = idOverride || uid('tex');
    const info = await analyzeImage(blob).catch(() => ({}));
    const channel = detectChannel(name, info.stats);
    const record = {
      id,
      name: idOverride ? prettyName(name) : this.uniqueName(prettyName(name)),
      kind: 'texture',
      ext: fileExt(name),
      size: blob.size,
      createdAt: Date.now(),
      thumb: info.thumb || '',
      source,
      meta: {
        width: info.width || 0,
        height: info.height || 0,
        channel,
        filename: baseName(name),
      },
    };
    await storage.putAsset(record);
    if (source.kind === 'single') {
      await storage.putFile(id, { blob, name });
      this.pendingBlobs.set(id, blob);
    }
    this.assets.set(id, record);
    if (!silent) emit('assets:changed');
    return record;
  }

  async importEnv({ name, blob, source = { kind: 'single' }, idOverride = null }) {
    if (!blob) return null;
    const id = idOverride || uid('env');
    const record = {
      id,
      name: idOverride ? prettyName(name) : this.uniqueName(prettyName(name)),
      kind: 'env',
      ext: fileExt(name),
      size: blob.size,
      createdAt: Date.now(),
      thumb: '',
      source,
      meta: { hdr: true },
    };
    await storage.putAsset(record);
    if (source.kind === 'single') {
      await storage.putFile(id, { blob, name });
      this.pendingBlobs.set(id, blob);
    }
    this.assets.set(id, record);
    emit('assets:changed');
    return record;
  }

  // ══════════════════ smart textures ══════════════════
  async smartMatch(object, assetName, candidateRecords = null) {
    if (!app.settings?.smartTextures) return 0;
    const records = candidateRecords || this.list('texture');
    if (!records.length) return 0;
    const materials = collectMaterials(object).map((entry) => ({
      material: entry.material,
      object: entry.object,
      context: [assetName],
    }));
    const textures = records.map((r) => ({
      id: r.id,
      name: r.name,
      filename: r.meta?.filename || r.name,
      channel: r.meta?.channel || detectChannel(r.name),
    }));
    const matches = matchTextures({
      materials,
      textures,
      assetName,
      mode: app.settings.smartAggression || 'balanced',
    });
    if (!matches.length) return 0;
    let applied = 0;
    const seenTextures = new Map();
    for (const m of matches) {
      const entry = materials[m.materialIndex];
      if (!entry) continue;
      let tex = this.textures.get(m.textureId);
      if (!tex) {
        if (!seenTextures.has(m.textureId)) seenTextures.set(m.textureId, this.ensureTexture(m.textureId));
        tex = await seenTextures.get(m.textureId).catch(() => null);
      }
      if (tex && applyTextureToSlot(entry.material, m.slot, tex, m.textureId)) applied++;
    }
    return applied;
  }

  async rematchObject(object, assetName = '') {
    const count = await this.smartMatch(object, assetName || object.name, this.list('texture'));
    emit('toast', { text: count ? `Applied ${count} smart texture${count > 1 ? 's' : ''}` : 'No confident texture matches', type: count ? 'success' : 'warn' });
    return count;
  }

  // ══════════════════ lazy loading ══════════════════
  async _sourceFiles(source) {
    if (!source) return [];
    if (source.kind === 'single') return null; // single file handled separately
    if (source.kind === 'batch') {
      if (this.batches.has(source.batchId)) return this.batches.get(source.batchId);
      const rec = await storage.getFile(source.batchId);
      const manifest = rec?.manifest || { files: [] };
      const files = [];
      for (const f of manifest.files) {
        const payload = await storage.getFile(f.key);
        if (payload?.blob) files.push({ path: f.path, blob: payload.blob });
      }
      this.batches.set(source.batchId, files);
      return files;
    }
    if (source.kind === 'zip') {
      if (this.archives.has(source.archiveId)) return this.archives.get(source.archiveId);
      const payload = await storage.getFile(source.archiveId);
      if (!payload?.blob) return [];
      const zip = await window.JSZip.loadAsync(payload.blob);
      const files = [];
      for (const path of Object.keys(zip.files)) {
        const entry = zip.files[path];
        if (!entry || entry.dir) continue;
        const ext = fileExt(path);
        if (!SUPPORTED.has(ext)) continue;
        const blob = await entry.async('blob');
        files.push({ path, blob: blob.type ? blob : blob.slice(0, blob.size, MIME[ext] || 'application/octet-stream') });
      }
      this.archives.set(source.archiveId, files);
      return files;
    }
    return [];
  }

  async _blobFor(asset) {
    if (!asset) return null;
    if (this.pendingBlobs.has(asset.id)) return this.pendingBlobs.get(asset.id);
    const source = asset.source || { kind: 'single' };
    if (source.kind === 'single') {
      const payload = await storage.getFile(asset.id);
      if (payload?.blob) { this.pendingBlobs.set(asset.id, payload.blob); return payload.blob; }
      return null;
    }
    const files = await this._sourceFiles(source);
    if (!files) return null;
    const target = (source.path || '').replace(/\\/g, '/').toLowerCase();
    const bn = baseName(source.path || '').toLowerCase();
    const found = files.find((f) => f.path.replace(/\\/g, '/').toLowerCase() === target)
      || files.find((f) => baseName(f.path).toLowerCase() === bn)
      || files.find((f) => f.path.toLowerCase() === (asset.name || '').toLowerCase());
    return found?.blob || null;
  }

  async ensureTexture(id) {
    if (this.textures.has(id)) return this.textures.get(id);
    if (this.loading.has(`tex:${id}`)) return this.loading.get(`tex:${id}`);
    const promise = (async () => {
      const asset = this.assets.get(id);
      if (!asset) return null;
      const blob = await this._blobFor(asset);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      try {
        const tex = await new THREE.TextureLoader().loadAsync(url);
        tex.name = asset.name;
        tex.userData.assetId = id;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = Math.min(8, app.engine?.renderer?.capabilities.getMaxAnisotropy?.() || 4);
        tex.channel = 0;
        tex.userData.channelName = asset.meta?.channel || detectChannel(asset.name);
        tex.userData.assetId = id;
        this.textures.set(id, tex);
        return tex;
      } finally {
        URL.revokeObjectURL(url);
        this.loading.delete(`tex:${id}`);
      }
    })().catch((e) => {
      console.warn('[texture] load failed', id, e);
      this.loading.delete(`tex:${id}`);
      return null;
    });
    this.loading.set(`tex:${id}`, promise);
    return promise;
  }

  async ensureEnvTexture(id) {
    if (this.envTextures.has(id)) return this.envTextures.get(id);
    if (this.loading.has(`env:${id}`)) return this.loading.get(`env:${id}`);
    const promise = (async () => {
      const asset = this.assets.get(id);
      if (!asset) return null;
      const blob = await this._blobFor(asset);
      if (!blob) return null;
      const buffer = await blob.arrayBuffer();
      const ext = fileExt(asset.name || asset.ext || '');
      let tex;
      if (ext === 'exr' || asset.ext === 'exr') {
        tex = new EXRLoader().parse(buffer);
      } else {
        tex = new HDRLoader().parse(buffer);
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.userData.assetId = id;
      this.envTextures.set(id, tex);
      this.loading.delete(`env:${id}`);
      return tex;
    })().catch((e) => {
      console.warn('[env] load failed', id, e);
      this.loading.delete(`env:${id}`);
      emit('toast', { text: 'Could not read that environment map', type: 'err' });
      return null;
    });
    this.loading.set(`env:${id}`, promise);
    return promise;
  }

  async ensureTemplate(id) {
    if (this.templates.has(id)) return this.templates.get(id);
    if (this.loading.has(`model:${id}`)) return this.loading.get(`model:${id}`);
    const promise = (async () => {
      const asset = this.assets.get(id);
      if (!asset || asset.kind !== 'model') return null;
      let files = [];
      const source = asset.source || { kind: 'single' };
      if (source.kind === 'single') {
        const blob = await this._blobFor(asset);
        if (!blob) throw new Error('Source file missing');
        files = [{ path: asset.name + '.' + (asset.ext || 'glb'), blob }];
      } else {
        files = await this._sourceFiles(source);
      }
      if (!files?.length) throw new Error('Source files missing');
      const mainPath = source.path || files[0].path;
      const bundle = this._buildBundle(files, mainPath);
      const parsed = await this._parseModel(bundle);
      const object = parsed.object;
      object.name = asset.name;
      object.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      // restore saved auto texture assignments recorded on the materials
      this.templates.set(id, object);
      if (parsed.animations?.length) this.clips.set(id, parsed.animations);
      this.loading.delete(`model:${id}`);
      return object;
    })().catch((e) => {
      console.warn('[model] ensure failed', id, e);
      this.loading.delete(`model:${id}`);
      emit('toast', { text: `Could not reload ${this.assets.get(id)?.name || 'model'}`, type: 'err' });
      return null;
    });
    this.loading.set(`model:${id}`, promise);
    return promise;
  }

  async deleteAsset(id) {
    const asset = this.assets.get(id);
    if (!asset) return;
    this.assets.delete(id);
    this.templates.delete(id);
    this.clips.delete(id);
    const tex = this.textures.get(id);
    if (tex) { tex.dispose(); this.textures.delete(id); }
    const env = this.envTextures.get(id);
    if (env) { env.dispose(); this.envTextures.delete(id); }
    this.pendingBlobs.delete(id);
    await storage.deleteAsset(id);
    emit('assets:changed');
  }

  async renameAsset(id, name) {
    const asset = this.assets.get(id);
    if (!asset) return;
    asset.name = name;
    await storage.putAsset(asset);
    emit('assets:changed');
  }

  dispose() {
    for (const u of blobUrlMap.values()) u.forEach((x) => URL.revokeObjectURL(x));
    blobUrlMap.clear();
  }
}

// ── helpers ───────────────────────────────────────────────────
async function analyzeImage(blob) {
  const out = { width: 0, height: 0, thumb: '', stats: null };
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return out;
  }
  out.width = bitmap.width;
  out.height = bitmap.height;

  // thumbnail, fitted inside 280×280
  const T = 280;
  const scale = Math.min(T / bitmap.width, T / bitmap.height, 1);
  const tw = Math.max(1, Math.round(bitmap.width * scale));
  const th = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, tw, th);
  try {
    out.thumb = canvas.toDataURL('image/webp', 0.82);
    if (!out.thumb.startsWith('data:image/webp')) out.thumb = canvas.toDataURL('image/png');
  } catch {
    out.thumb = canvas.toDataURL('image/png');
  }

  // colour statistics for heuristic channel detection
  const S = 24;
  const sc = document.createElement('canvas');
  sc.width = S;
  sc.height = S;
  const sctx = sc.getContext('2d');
  sctx.drawImage(bitmap, 0, 0, S, S);
  try {
    const data = sctx.getImageData(0, 0, S, S).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] / 255;
      g += data[i + 1] / 255;
      b += data[i + 2] / 255;
      a += data[i + 3] / 255;
    }
    const n = data.length / 4;
    out.stats = { r: r / n, g: g / n, b: b / n, alpha: a / n };
  } catch { /* tainted */ }

  bitmap.close?.();
  return out;
}

export { cloneSkeleton, blobUrlMap };

function createLoadWaiter(manager) {
  let started = 0;
  let finished = 0;
  let waiters = [];
  const resolveAll = () => {
    finished = Math.max(finished, started);
    for (const r of waiters) r();
    waiters = [];
  };
  manager.onStart = () => { started++; };
  manager.onLoad = resolveAll;
  manager.onError = () => { finished++; };
  return {
    async wait(timeoutMs = 2500) {
      if (finished >= started) return;
      await Promise.race([
        new Promise((resolve) => waiters.push(resolve)),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}
