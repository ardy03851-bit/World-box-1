import * as THREE from 'three';
import { normalizeName, stripExt, baseName } from '../core/util.js';
import { TEXTURE_SLOTS } from '../core/materials.js';

const CHANNEL_PATTERNS = [
  { channel: 'clearcoatNormalMap', re: /(clearcoat.*normal|coat.*normal|clearcoat.*nrm|coat_n)/i },
  { channel: 'normalMap', re: /(normal|nrm|nor\b|normalmap|bumpmap|_n_|_n$|_norm|normalgl|normaldx)/i },
  { channel: 'aoMap', re: /(ambient.?occlusion|occlusion|\bao\b|_ao_|_ao$|occlusionmap)/i },
  { channel: 'roughnessMap', re: /(roughness|rough|rgh|glossiness|gloss)/i },
  { channel: 'metalnessMap', re: /(metalness|metallic|metal|mtl|specular)/i },
  { channel: 'emissiveMap', re: /(emissive|emission|emit|glow)/i },
  { channel: 'alphaMap', re: /(opacity|alpha|transparency|mask)/i },
  { channel: 'displacementMap', re: /(displacement|displace|height|heightmap|depth|bump)/i },
  { channel: 'sheenColorMap', re: /(sheen)/i },
  { channel: 'map', re: /(basecolor|base.?color|albedo|diffuse|diff|color|colour|_col_|_col$|_bc_|_bc$|base|tex\b|texture)/i },
];

const CHANNEL_WORDS = /(basecolor|base.?color|albedo|diffuse|diff|color|colour|col|bc|tex|texture|normal|nrm|nor|norm|normalgl|normaldx|ambient.?occlusion|occlusion|ao|roughness|rough|rgh|glossiness|gloss|metalness|metallic|metal|mtl|specular|emissive|emission|emit|glow|opacity|alpha|transparency|mask|displacement|displace|height|heightmap|depth|bump|sheen|clearcoat|coat|map|pbr|orm|arm|mrao|packed|srgb|linear|4k|2k|1k|8k|2048|4096|1024)/gi;

export function detectChannel(filename = '', stats = null) {
  const name = stripExt(baseName(filename));
  // combined channel packs
  if (/(^|[_\-. ])(orm|arm|mrao|rma|aorm|occlusionroughnessmetalness)([_\-. ]|$)/i.test(name)) return 'orm';
  for (const { channel, re } of CHANNEL_PATTERNS) {
    if (re.test(name)) return channel;
  }
  if (stats) {
    const { r, g, b, alpha } = stats;
    if (b > r * 1.12 && b > g * 1.04 && b > 0.35) return 'normalMap';
    if (alpha < 0.99) return 'alphaMap';
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.035) return 'roughnessMap';
  }
  return null;
}

export function stemOf(filename = '') {
  let s = stripExt(baseName(filename)).toLowerCase();
  s = s.replace(CHANNEL_WORDS, ' ');
  s = s.replace(/[^a-z0-9]+/g, '');
  return s;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1));
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

export function similarity(a = '', b = '') {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
    return 0.55 + ratio * 0.4;
  }
  const maxLen = Math.max(x.length, y.length);
  const lev = 1 - levenshtein(x, y) / maxLen;
  return Math.max(0, lev) * 0.85;
}

function contextScore(texStem, contextNames) {
  let best = 0;
  for (const raw of contextNames) {
    if (!raw) continue;
    const name = String(raw);
    best = Math.max(best, similarity(texStem, name));
    const tokens = name.split(/[^\w]+/).filter((t) => t.length > 2);
    for (const token of tokens) {
      best = Math.max(best, similarity(texStem, token) * 0.92);
    }
  }
  return best;
}

const SLOT_FALLBACK = {
  normalMap: 'normalMap',
  roughnessMap: 'roughnessMap',
  metalnessMap: 'metalnessMap',
  aoMap: 'aoMap',
  emissiveMap: 'emissiveMap',
  alphaMap: 'alphaMap',
  displacementMap: 'displacementMap',
  sheenColorMap: 'sheenColorMap',
  clearcoatNormalMap: 'clearcoatNormalMap',
  map: 'map',
};

export function thresholdFor(mode = 'balanced') {
  return mode === 'eager' ? 0.3 : mode === 'conservative' ? 0.62 : 0.45;
}

/**
 * Match a list of texture assets to the missing material slots of a model.
 * Metadata only — no GPU textures are needed for the decision.
 */
export function matchTextures({ materials = [], textures = [], assetName = '', mode = 'balanced', overwrite = false }) {
  if (!materials.length || !textures.length) return [];
  const threshold = thresholdFor(mode);
  const single = materials.length === 1;
  const used = new Map();
  const out = [];

  const bank = textures.map((t) => ({
    ...t,
    channel: t.channel || detectChannel(t.name || t.filename || ''),
    stem: t.stem || stemOf(t.name || t.filename || ''),
  }));

  for (let mi = 0; mi < materials.length; mi++) {
    const entry = materials[mi];
    const mat = entry?.material;
    if (!mat) continue;
    const generic = !mat.name || /^(material|mat|default|unnamed|mesh|object|lambert|phong|standard|physical)/i.test(mat.name.trim());
    const contextNames = [assetName, mat.name, entry.object?.name, ...(entry.context || [])];
    const bySlot = new Map();

    for (const t of bank) {
      if (!t.channel) continue;
      const slots = t.channel === 'orm' ? ['aoMap', 'roughnessMap', 'metalnessMap'] : [t.channel];
      const ctx = contextScore(t.stem, contextNames);
      const bonus = generic && single ? (t.channel === 'map' ? 0.32 : 0.42) : 0;
      const effective = Math.max(ctx, bonus);
      for (const slot of slots) {
        if (!(slot in mat)) continue;
        if (!overwrite && mat[slot]) continue;
        if (effective < threshold) continue;
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot).push({ t, effective, slot });
      }
    }

    for (const [slot, list] of bySlot) {
      list.sort((a, b) => b.effective - a.effective);
      let chosen = null;
      for (const cand of list) {
        const previous = used.get(cand.t.id);
        if (!previous || cand.t.channel === 'orm' || cand.effective >= 0.78) {
          chosen = cand;
          break;
        }
      }
      if (!chosen) continue;
      if (chosen.t.channel !== 'orm') used.set(chosen.t.id, mi);
      out.push({ materialIndex: mi, slot, textureId: chosen.t.id, score: chosen.effective, name: chosen.t.name, channel: chosen.t.channel });
    }
  }
  return out;
}

/**
 * Older convenience wrapper used for already-loaded textures.
 */
export function autoAssignTextures({ materials = [], textures = [], assetName = '', mode = 'balanced', overwrite = false }) {
  const matches = matchTextures({ materials, textures, assetName, mode, overwrite });
  const applied = [];
  for (const m of matches) {
    const entry = materials[m.materialIndex];
    const t = textures.find((x) => x.id === m.textureId);
    if (!entry || !t?.texture) continue;
    if (applyTextureToSlot(entry.material, m.slot, t.texture, t.id)) applied.push(m);
  }
  return applied;
}

/**
 * Best guess for which slot a dragged texture should fill on a selected object.
 */
export function pickSlotForTexture(textureName, material, contextNames = []) {
  const channel = detectChannel(textureName);
  if (channel === 'orm') {
    if (!material?.roughnessMap) return 'roughnessMap';
    if (!material?.metalnessMap) return 'metalnessMap';
    if (!material?.aoMap) return 'aoMap';
    return 'roughnessMap';
  }
  if (channel) return channel;
  // unknown: use base colour unless it is taken
  if (!material?.map) return 'map';
  if (!material?.roughnessMap) return 'roughnessMap';
  return 'map';
}

/**
 * Wire a loaded texture into a material slot, recording the asset id for
 * project serialization.
 */
export function applyTextureToSlot(material, slot, texture, textureId = null) {
  const def = TEXTURE_SLOTS.find((s) => s.key === slot);
  if (!material || !texture || !def) return false;
  try {
    texture.colorSpace = def.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.max(texture.anisotropy || 1, 4);
    texture.needsUpdate = true;
  } catch { /* texture already disposed */ }
  material[slot] = texture;
  if (textureId) {
    material.userData = material.userData || {};
    material.userData.texIds = material.userData.texIds || {};
    material.userData.texIds[slot] = textureId;
  }
  if (slot === 'alphaMap') material.transparent = true;
  if (slot === 'map' || slot === 'emissiveMap' || slot === 'normalMap') material.needsUpdate = true;
  return true;
}

export function clearSlot(material, slot) {
  if (!material) return;
  material[slot] = null;
  if (material.userData?.texIds) delete material.userData.texIds[slot];
  material.needsUpdate = true;
}
