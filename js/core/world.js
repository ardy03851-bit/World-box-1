import * as THREE from 'three';
import { emit } from '../bus.js';
import { app } from '../app.js';
import { cloneSkeleton } from '../assets/library.js';
import { Environment } from './environment.js';
import {
  createPrimitive,
  createTerrain,
  createLightObject,
  instantiateAsset,
  primitiveGeometry,
  dropToFloor,
  PRIMITIVES,
} from './objects.js';
import {
  collectMaterials,
  readMaterialState,
  applyMaterialState,
  materialStateFromPreset,
  MATERIAL_PRESETS,
  TEXTURE_SLOTS,
} from './materials.js';
import { applyTextureToSlot, clearSlot } from '../assets/textures.js';
import { clamp, deepClone, uid } from './util.js';

const GROUND_Y = 0;

export class World {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.content = new THREE.Group();
    this.content.name = 'content';
    scene.add(this.content);
    this.records = new Map();
    this.env = new Environment(scene, engine.renderer, engine);
    this.envState = null;
    this.raycaster = new THREE.Raycaster();
    this.tmpVec = new THREE.Vector3();
    this.projectName = 'Untitled World';
    this.frameOff = engine.onFrame((dt) => {
      for (const rec of this.records.values()) {
        if (rec.mixer) rec.mixer.update(dt);
      }
    });
  }

  resolveTexture = (id) => app.library?.textures.get(id) || null;

  // ── environment ──────────────────────────────────────────────
  applyEnvironment(env, { immediate = true } = {}) {
    this.envState = env;
    this.env.apply(env, app.settings, { immediate });
    this.engine.applyLook(env, app.settings);
  }

  setEnvironment(partial, { immediate = true } = {}) {
    const env = app.project.environment;
    Object.assign(env, partial);
    this.applyEnvironment(env, { immediate });
    this.engine.applyLook(env, app.settings);
    emit('environment:changed');
    emit('project:changed', { source: 'environment' });
  }

  refreshEnvironment(immediate = true) {
    if (!app.project) return;
    this.applyEnvironment(app.project.environment, { immediate });
  }

  // ── object creation ──────────────────────────────────────────
  createRoot(desc) {
    switch (desc.kind) {
      case 'asset': {
        const template = app.library?.templates.get(desc.assetId);
        if (!template) return null;
        return instantiateAsset(template, desc, this.resolveTexture, cloneSkeleton);
      }
      case 'terrain':
        return createTerrain(desc, this.resolveTexture);
      case 'light':
        return createLightObject(desc);
      case 'group':
        return new THREE.Group();
      default:
        return createPrimitive(desc, this.resolveTexture);
    }
  }

  addObject(desc, { select = true, silent = false } = {}) {
    if (!desc.id) desc.id = uid('o');
    let root = null;
    try {
      root = this.createRoot(desc);
    } catch (e) {
      console.error('[world] create failed', e?.stack || e);
      emit('toast', { text: `Could not add ${desc.name || 'object'}`, type: 'err' });
      return null;
    }
    if (!root) {
      if (desc.kind === 'asset') emit('toast', { text: 'That model is still loading…', type: 'warn' });
      return null;
    }
    root.userData.recordId = desc.id;
    root.userData.kind = desc.kind || 'primitive';
    root.name = desc.name || root.name || 'Object';
    this.applyTransform(root, desc.transform);
    root.visible = desc.visible !== false;
    if (desc.locked) root.userData.locked = true;

    if (desc.kind === 'asset' && app.settings?.autoPlayAnimations) {
      const clips = app.library?.clips.get(desc.assetId);
      if (clips?.length) {
        const mixer = new THREE.AnimationMixer(root);
        try {
          mixer.clipAction(clips[0]).play();
        } catch { /* ignore */ }
        this._pendingMixer = mixer;
      }
    }

    this.content.add(root);
    root.updateMatrixWorld(true);
    const record = { id: desc.id, desc, root, mixer: this._pendingMixer || null };
    this._pendingMixer = null;
    this.records.set(desc.id, record);

    if (desc.settle) {
      this.settleOnTerrain(root, desc.settleOffset || 0);
      delete desc.settle;
      desc.transform = this.readTransform(root);
    }

    if (select) this.select(desc.id);
    if (!silent) {
      emit('objects:changed');
      emit('project:changed', { source: 'add' });
    }
    return record;
  }

  applyTransform(root, t = {}) {
    root.position.fromArray(t.p || [0, 0, 0]);
    root.rotation.set(...(t.r || [0, 0, 0]));
    root.scale.fromArray(t.s || [1, 1, 1]);
    root.updateMatrixWorld(true);
  }

  readTransform(root) {
    return {
      p: [root.position.x, root.position.y, root.position.z].map(r5),
      r: [root.rotation.x, root.rotation.y, root.rotation.z].map((n) => Math.round(n * 1e5) / 1e5),
      s: [root.scale.x, root.scale.y, root.scale.z].map(r5),
    };
  }

  syncTransform(id) {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.desc.transform = this.readTransform(rec.root);
    emit('objects:changed');
    emit('project:changed', { source: 'transform' });
  }

  // ── terrain settling & picking ───────────────────────────────
  terrainMeshes() {
    const meshes = [];
    for (const rec of this.records.values()) {
      if (rec.desc.kind !== 'terrain') continue;
      rec.root.traverse((o) => {
        if (o.isMesh && !o.userData.isWater) meshes.push(o);
      });
    }
    return meshes;
  }

  settleOnTerrain(root, offset = 0) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const origin = new THREE.Vector3(center.x, 500, center.z);
    this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(this.terrainMeshes(), false);
    if (!hits.length) return;
    const targetY = hits[0].point.y + offset;
    root.position.y += targetY - box.min.y;
    root.updateMatrixWorld(true);
  }

  dropSelectedToFloor() {
    const rec = this.getSelectedRecord();
    if (!rec) return;
    rec.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rec.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    this.raycaster.set(new THREE.Vector3(center.x, 500, center.z), new THREE.Vector3(0, -1, 0));
    const hits = this.raycaster.intersectObjects(this.terrainMeshes(), false);
    const y = hits.length ? hits[0].point.y : GROUND_Y;
    const delta = y - box.min.y;
    rec.root.position.y += delta;
    this.syncTransform(rec.id);
    this.engine.updateBrackets();
  }

  pickRecord(clientX, clientY) {
    const rect = this.engine.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const hit of hits) {
      let o = hit.object;
      if (o.userData?.isEnvironment) continue;
      while (o && !o.userData?.recordId) o = o.parent;
      if (!o?.userData?.recordId) continue;
      const rec = this.records.get(o.userData.recordId);
      if (!rec) continue;
      if (!this.isEffectivelyVisible(rec.root)) continue;
      return rec;
    }
    return null;
  }

  isEffectivelyVisible(o) {
    let cur = o;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  pickSurface(clientX, clientY) {
    const rect = this.engine.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && !o.userData?.recordId) o = o.parent;
      if (o?.userData?.recordId) {
        return { record: this.records.get(o.userData.recordId), point: hit.point };
      }
    }
    return null;
  }

  pointOnGround(clientX, clientY) {
    const rect = this.engine.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.engine.camera);
    const hits = this.raycaster.intersectObjects(this.terrainMeshes(), false);
    if (hits.length) return hits[0].point.clone();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, pt) ? pt : new THREE.Vector3(0, 0, 0);
  }

  // ── selection ────────────────────────────────────────────────
  select(id, { materialIndex = 0 } = {}) {
    if (id && !this.records.has(id)) return;
    app.selection = id || null;
    app.selectedMaterial = materialIndex;
    const rec = this.records.get(id) || null;
    this.engine.attachGizmo(rec && !rec.desc.locked ? rec.root : null);
    emit('selection:changed', rec);
    if (rec) this.syncSelectionUI();
  }

  getSelectedRecord() {
    return this.records.get(app.selection) || null;
  }

  syncSelectionUI() {
    const rec = this.getSelectedRecord();
    if (!rec) return;
    emit('selection:refresh', rec);
  }

  selectByIndex(dir) {
    const list = [...this.records.values()].filter((r) => r.desc.visible !== false);
    if (!list.length) return;
    let i = list.findIndex((r) => r.id === app.selection);
    i = (i + dir + list.length) % list.length;
    this.select(list[i].id);
    this.engine.frameObject(list[i].root);
  }

  // ── records listing & mutation ───────────────────────────────
  list() {
    return [...this.records.values()].map((r) => ({
      id: r.id,
      name: r.root.name,
      kind: r.desc.kind || 'primitive',
      visible: r.root.visible,
      locked: !!r.desc.locked,
      record: r,
    }));
  }

  get(id) {
    return this.records.get(id) || null;
  }

  removeRecord(id, { silent = false } = {}) {
    const rec = this.records.get(id);
    if (!rec) return;
    if (rec.mixer) rec.mixer.stopAllAction();
    this.content.remove(rec.root);
    disposeObject(rec.root);
    this.records.delete(id);
    if (app.selection === id) {
      app.selection = null;
      this.engine.attachGizmo(null);
      emit('selection:changed', null);
    }
    if (!silent) {
      emit('objects:changed');
      emit('project:changed', { source: 'remove' });
    }
  }

  clear({ silent = false } = {}) {
    for (const rec of [...this.records.values()]) {
      if (rec.mixer) rec.mixer.stopAllAction();
      this.content.remove(rec.root);
      disposeObject(rec.root);
    }
    this.records.clear();
    app.selection = null;
    this.engine.attachGizmo(null);
    if (!silent) {
      emit('objects:changed');
      emit('selection:changed', null);
    }
  }

  duplicateSelected() {
    const rec = this.getSelectedRecord();
    if (!rec) return;
    const desc = this.serializeObject(rec);
    desc.id = uid('o');
    desc.name = `${rec.root.name} copy`;
    delete desc.settle;
    const r = rec.root;
    const p = r.position.clone();
    desc.transform.p = [p.x + 0.55, p.y, p.z + 0.55];
    const newRec = this.addObject(desc, { select: true });
    if (newRec) {
      emit('toast', { text: `${desc.name} created`, type: 'success' });
    }
  }

  // ── primitive/terrain/light updates ──────────────────────────
  updateDescriptor(id, mutator, { rebuild = false, reselect = true } = {}) {
    const rec = this.records.get(id);
    if (!rec) return;
    const desc = rec.desc;
    const transform = this.readTransform(rec.root);
    const visible = rec.root.visible;
    if (desc.kind === 'primitive' || desc.kind === 'terrain') {
      const entry = collectMaterials(rec.root)[0];
      if (entry) desc.material = readMaterialState(entry.material);
    }
    if (desc.kind === 'light') {
      const l = rec.root;
      desc.light = {
        ...desc.light,
        color: `#${new THREE.Color(l.color || 0xffffff).getHexString()}`,
        intensity: l.intensity,
      };
      if (l.isSpotLight) {
        desc.light.angle = Math.round((l.angle * 180) / Math.PI);
        desc.light.penumbra = l.penumbra;
        desc.light.distance = l.distance;
      }
    }
    mutator(desc);
    if (rebuild) {
      this.content.remove(rec.root);
      if (rec.mixer) rec.mixer.stopAllAction();
      disposeObject(rec.root, { keepTextures: true });
      this.records.delete(id);
      desc.transform = transform;
      desc.visible = visible;
      const newRec = this.addObject(desc, { select: false, silent: true });
      if (newRec) {
        if (app.selection === id) this.engine.attachGizmo(newRec.root);
        emit('objects:changed');
        emit('project:changed', { source: 'geometry' });
        void reselect;
      }
    } else {
      emit('objects:changed');
      emit('project:changed', { source: 'descriptor' });
    }
  }

  setRecordTransform(id, patch) {
    const rec = this.records.get(id);
    if (!rec) return;
    if (patch.p) rec.root.position.fromArray(patch.p);
    if (patch.r) rec.root.rotation.set(...patch.r);
    if (patch.s) rec.root.scale.fromArray(patch.s);
    rec.root.updateMatrixWorld(true);
    rec.desc.transform = this.readTransform(rec.root);
    this.engine.updateBrackets();
    emit('project:changed', { source: 'transform' });
  }

  setVisibility(id, visible) {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.root.visible = visible;
    rec.desc.visible = visible;
    if (app.selection === id) this.engine.attachGizmo(rec.root);
    emit('objects:changed');
    emit('project:changed', { source: 'visibility' });
  }

  setLocked(id, locked) {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.desc.locked = locked;
    rec.root.userData.locked = locked;
    if (app.selection === id) this.engine.attachGizmo(locked ? null : rec.root);
    emit('objects:changed');
    emit('project:changed', { source: 'lock' });
  }

  rename(id, name) {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.root.name = name;
    rec.desc.name = name;
    emit('objects:changed');
    emit('project:changed', { source: 'rename' });
  }

  // ── adding things ────────────────────────────────────────────
  addPrimitive(type, { material = 'ceramic', params = null } = {}) {
    const def = PRIMITIVES.find((p) => p.type === type) || PRIMITIVES[0];
    const target = this.engine.controls.target.clone();
    const y = type === 'plane' || type === 'ring' ? 0.01 : 1.1;
    const desc = {
      id: uid('o'),
      name: def.label,
      kind: 'primitive',
      primitive: { type, params: { ...deepClone(def.params), ...(params || {}) } },
      material: materialStateFromPreset(material),
      transform: { p: [target.x, y, target.z], r: type === 'plane' || type === 'ring' ? [-Math.PI / 2, 0, 0] : [0, 0, 0], s: [1, 1, 1] },
      visible: true,
    };
    const rec = this.addObject(desc);
    emit('toast', { text: `${def.label} added`, type: 'success' });
    return rec;
  }

  addTerrain(params = {}) {
    const target = this.engine.controls.target;
    const desc = {
      id: uid('o'),
      name: 'Terrain',
      kind: 'terrain',
      terrain: { size: 140, resolution: 150, amp: 4, freq: 1, octaves: 5, seed: Math.floor(Math.random() * 999), ridged: false, ...params },
      material: materialStateFromPreset('clay', { color: '#6b6257', roughness: 0.92 }),
      transform: { p: [target.x, 0, target.z], r: [0, 0, 0], s: [1, 1, 1] },
      visible: true,
    };
    const rec = this.addObject(desc);
    emit('toast', { text: 'Terrain generated', type: 'success' });
    return rec;
  }

  addLight(type = 'point', opts = {}) {
    const target = this.engine.controls.target;
    const names = { point: 'Point light', spot: 'Spot light', directional: 'Sun light', hemi: 'Sky light', ambient: 'Ambient' };
    const desc = {
      id: uid('o'),
      name: names[type] || 'Light',
      kind: 'light',
      light: {
        type,
        color: opts.color || '#ffe9cf',
        intensity: opts.intensity ?? (type === 'directional' ? 3 : type === 'ambient' ? 0.4 : 14),
        distance: 0,
        angle: 42,
        penumbra: 0.5,
        castShadow: type !== 'ambient' && type !== 'hemi',
        groundColor: '#22252c',
        ...opts,
      },
      transform: { p: [target.x + 1.5, type === 'ambient' || type === 'hemi' ? 2 : 4, target.z + 1.5], r: [0, 0, 0], s: [1, 1, 1] },
      visible: true,
    };
    const rec = this.addObject(desc);
    emit('toast', { text: `${names[type] || 'Light'} added`, type: 'success' });
    return rec;
  }

  addAsset(assetId, { at = null, select = true, surface = null } = {}) {
    const asset = app.library?.get(assetId);
    if (!asset) return null;
    const target = at || this.engine.controls.target;
    const desc = {
      id: uid('o'),
      name: asset.name,
      kind: 'asset',
      assetId,
      transform: { p: [target.x, 0, target.z], r: [0, 0, 0], s: [1, 1, 1] },
      visible: true,
      materials: [],
    };
    const rec = this.addObject(desc, { select });
    if (rec) {
      // drop onto the floor / terrain
      rec.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rec.root);
      if (!box.isEmpty()) {
        const terrain = this.terrainMeshes();
        let y = 0;
        if (terrain.length) {
          this.raycaster.set(new THREE.Vector3(target.x, 500, target.z), new THREE.Vector3(0, -1, 0));
          const hits = this.raycaster.intersectObjects(terrain, false);
          if (hits.length) y = hits[0].point.y;
        }
        if (surface) {
          rec.root.position.y += surface.y - box.min.y + 0.015;
        } else {
          rec.root.position.y += y - box.min.y;
        }
        this.syncTransform(rec.id);
        this.engine.frameObject(rec.root, { animate: true });
      }
    }
    return rec;
  }

  scatterSelected({ count = 12, radius = 8, scaleJitter = 0.5 } = {}) {
    const rec = this.getSelectedRecord();
    if (!rec) return;
    const base = this.serializeObject(rec);
    const origin = rec.root.position.clone();
    const made = [];
    for (let i = 0; i < count; i++) {
      const desc = deepClone(base);
      desc.id = uid('o');
      desc.name = `${base.name} ${i + 1}`;
      delete desc.settle;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const s = 1 + (Math.random() - 0.5) * scaleJitter;
      desc.transform.p = [origin.x + Math.cos(a) * r, origin.y, origin.z + Math.sin(a) * r];
      desc.transform.r = [desc.transform.r[0], Math.random() * Math.PI * 2, desc.transform.r[2]];
      desc.transform.s = desc.transform.s.map((v) => v * s);
      const nr = this.addObject(desc, { select: false, silent: true });
      if (nr) made.push(nr);
    }
    this.select(rec.id);
    emit('objects:changed');
    emit('project:changed', { source: 'scatter' });
    emit('toast', { text: `Scattered ${made.length} copies`, type: 'success' });
    return made;
  }

  alignSelected(axis = 'center') {
    const rec = this.getSelectedRecord();
    if (!rec) return;
    const box = new THREE.Box3().setFromObject(rec.root);
    if (box.isEmpty()) return;
    if (axis === 'center') {
      const c = box.getCenter(new THREE.Vector3());
      rec.root.position.x -= c.x;
      rec.root.position.z -= c.z;
    } else if (axis === 'floor') {
      rec.root.position.y -= box.min.y;
    }
    this.syncTransform(rec.id);
    this.engine.updateBrackets();
  }

  // ── materials ────────────────────────────────────────────────
  materialEntries(rec = this.getSelectedRecord()) {
    if (!rec) return [];
    return collectMaterials(rec.root).map((entry, i) => ({
      index: i,
      material: entry.material,
      object: entry.object,
      label: entry.material?.name || `Material ${i + 1}`,
      state: readMaterialState(entry.material),
      canEdit: !!entry.material && !!entry.material.isMaterial,
    }));
  }

  selectedMaterialEntry(index = app.selectedMaterial) {
    const entries = this.materialEntries();
    return entries[index] || entries[0] || null;
  }

  editMaterial(mutator, index = app.selectedMaterial) {
    const entries = this.materialEntries();
    const entry = entries[index] || entries[0];
    if (!entry) return;
    const state = readMaterialState(entry.material);
    mutator(entry.material, state);
    entry.material.needsUpdate = true;
    emit('material:changed', { index });
    emit('project:changed', { source: 'material' });
    this.engine.updateBrackets();
  }

  applyMaterialPreset(name, index = app.selectedMaterial) {
    const preset = MATERIAL_PRESETS[name];
    if (!preset) return;
    const entries = this.materialEntries();
    const entry = entries[index] || entries[0];
    if (!entry) return;
    const state = readMaterialState(entry.material);
    const next = { ...state, ...preset.state, maps: state.maps, preset: name };
    applyMaterialState(entry.material, next, this.resolveTexture);
    emit('material:changed', { index });
    emit('project:changed', { source: 'material' });
    emit('toast', { text: `${preset.label} applied`, type: 'success' });
  }

  applyPresetToAll(name) {
    const entries = this.materialEntries();
    if (!entries.length) return;
    const preset = MATERIAL_PRESETS[name];
    if (!preset) return;
    entries.forEach((entry) => {
      const state = { ...readMaterialState(entry.material), ...preset.state, preset: name };
      applyMaterialState(entry.material, state, this.resolveTexture);
    });
    emit('material:changed', {});
    emit('project:changed', { source: 'material' });
  }

  setTextureOnMaterial(slot, textureId, index = app.selectedMaterial) {
    const entries = this.materialEntries();
    const entry = entries[index] || entries[0];
    if (!entry) return;
    const tex = textureId ? app.library?.textures.get(textureId) : null;
    if (textureId && !tex) {
      emit('toast', { text: 'Texture is still loading…', type: 'warn' });
      return;
    }
    if (textureId) applyTextureToSlot(entry.material, slot, tex, textureId);
    else clearSlot(entry.material, slot);
    emit('material:changed', { index });
    emit('project:changed', { source: 'texture' });
  }

  applyTextureToRecord(record, textureId, slot = null) {
    if (!record) return 0;
    const tex = app.library?.textures.get(textureId);
    if (!tex) return 0;
    const channel = tex.channel || app.library?.get(textureId)?.meta?.channel || null;
    const entries = collectMaterials(record.root);
    let applied = 0;
    for (const entry of entries) {
      const target = slot || (channel === 'orm' ? 'roughnessMap' : channel) || (!entry.material.map ? 'map' : 'roughnessMap');
      const slots = channel === 'orm' && !slot ? ['roughnessMap', 'metalnessMap', 'aoMap'] : [target];
      for (const s of slots) {
        if (!(s in entry.material)) continue;
        applyTextureToSlot(entry.material, s, tex, textureId);
        applied++;
      }
    }
    if (app.selection === record.id) emit('material:changed', {});
    emit('project:changed', { source: 'texture' });
    return applied;
  }

  async applyTextureAssetToSelected(textureId) {
    const rec = this.getSelectedRecord();
    if (!rec) {
      emit('toast', { text: 'Select an object first', type: 'warn' });
      return;
    }
    await app.library.ensureTexture(textureId).catch(() => null);
    const tex = app.library.textures.get(textureId);
    if (!tex) return;
    const count = this.applyTextureToRecord(rec, textureId, null);
    emit('toast', { text: count ? `Texture applied to ${count} slot${count > 1 ? 's' : ''}` : 'No compatible slot', type: count ? 'success' : 'warn' });
  }

  // ── serialization ────────────────────────────────────────────
  serializeObject(rec) {
    const desc = deepClone(rec.desc);
    delete desc._mixer;
    desc.name = rec.root.name;
    desc.transform = this.readTransform(rec.root);
    desc.visible = rec.root.visible !== false;
    desc.locked = !!desc.locked;
    if (rec.desc.kind === 'light') {
      const l = rec.root;
      desc.light = {
        ...desc.light,
        type: desc.light?.type || 'point',
        color: `#${new THREE.Color(l.color || 0xffffff).getHexString()}`,
        intensity: l.intensity ?? desc.light?.intensity ?? 1,
      };
      if (l.isSpotLight) {
        desc.light.angle = Math.round((l.angle * 180) / Math.PI);
        desc.light.penumbra = l.penumbra;
        desc.light.distance = l.distance;
      }
      desc.light.castShadow = !!l.castShadow;
    }
    if (rec.desc.kind !== 'light') {
      desc.materials = collectMaterials(rec.root).map((e) => readMaterialState(e.material));
      if ((rec.desc.kind === 'primitive' || rec.desc.kind === 'terrain') && desc.materials.length) {
        desc.material = desc.materials[0];
      }
    }
    return desc;
  }

  serializeProject({ includeCamera = true } = {}) {
    const project = {
      version: 2,
      name: this.projectName,
      presetId: app.project?.presetId || null,
      environment: deepClone(app.project?.environment || this.envState || {}),
      objects: [...this.records.values()].map((r) => this.serializeObject(r)),
    };
    if (includeCamera) {
      project.camera = {
        position: this.engine.camera.position.toArray().map(r3),
        target: this.engine.controls.target.toArray().map(r3),
        fov: this.engine.camera.fov,
      };
    }
    return project;
  }

  async prefetchProject(project) {
    const texIds = new Set();
    for (const o of project.objects || []) {
      for (const m of o.materials || []) {
        for (const id of Object.values(m.maps || {})) {
          if (typeof id === 'string') texIds.add(id);
        }
      }
    }
    const modelIds = [...new Set((project.objects || []).filter((o) => o.kind === 'asset').map((o) => o.assetId))];
    await Promise.all([
      ...[...texIds].map((id) => app.library.ensureTexture(id).catch(() => null)),
      ...modelIds.map((id) => app.library.ensureTemplate(id).catch(() => null)),
    ]);
  }

  async loadProject(project, { restoreCamera = true } = {}) {
    if (!project) return;
    this.clear({ silent: true });
    this.projectName = project.name || 'Untitled World';
    app.project = project;
    await this.prefetchProject(project);
    this.applyEnvironment(project.environment, { immediate: true });
    let missing = 0;
    for (const desc of project.objects || []) {
      const copy = deepClone(desc);
      delete copy.settle;
      if (copy.kind === 'asset') {
        const tpl = app.library.templates.get(copy.assetId);
        if (!tpl) { missing++; continue; }
      }
      const rec = this.addObject(copy, { select: false, silent: true });
      if (rec && desc.settle) {
        try {
          this.settleOnTerrain(rec.root, desc.settleOffset || 0);
          rec.desc.transform = this.readTransform(rec.root);
          rec.desc.settle = true;
          rec.desc.settleOffset = desc.settleOffset || 0;
        } catch (e) {
          console.warn('[settle]', e);
        }
      }
    }
    if (missing) emit('toast', { text: `${missing} model${missing > 1 ? 's' : ''} could not be restored`, type: 'warn' });
    if (restoreCamera && project.camera) {
      const cam = project.camera;
      this.engine.camera.position.fromArray(cam.position || [7, 4, 9]);
      this.engine.controls.target.fromArray(cam.target || [0, 1, 0]);
      this.engine.camera.fov = cam.fov || 42;
      this.engine.camera.updateProjectionMatrix();
      this.engine.controls.update();
    }
    app.selection = null;
    this.engine.attachGizmo(null);
    emit('objects:changed');
    emit('selection:changed', null);
    emit('project:loaded', project);
  }

  frameAll() {
    this.engine.frameAll([...this.records.values()].map((r) => r.root));
  }

  frameSelected() {
    const rec = this.getSelectedRecord();
    if (rec) this.engine.frameObject(rec.root);
  }
}

function r3(n) { return Math.round(n * 1000) / 1000; }
function r5(n) { return Math.round(n * 1e5) / 1e5; }

function disposeObject(root, { keepTextures = false } = {}) {
  root.traverse((o) => {
    if (o.geometry && !o.userData?.sharedGeometry) o.geometry.dispose?.();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (m && m.userData?.cloned !== false) m.dispose?.();
      });
    }
  });
  root.parent?.remove(root);
}
