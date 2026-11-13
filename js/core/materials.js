import * as THREE from 'three';

export const TEXTURE_SLOTS = [
  { key: 'map', label: 'Base color', short: 'Base', srgb: true },
  { key: 'normalMap', label: 'Normal', short: 'Normal', srgb: false },
  { key: 'roughnessMap', label: 'Roughness', short: 'Rough', srgb: false },
  { key: 'metalnessMap', label: 'Metalness', short: 'Metal', srgb: false },
  { key: 'aoMap', label: 'Ambient occlusion', short: 'AO', srgb: false },
  { key: 'emissiveMap', label: 'Emissive', short: 'Glow', srgb: true },
  { key: 'alphaMap', label: 'Opacity', short: 'Alpha', srgb: false },
  { key: 'clearcoatNormalMap', label: 'Coat normal', short: 'Coat N', srgb: false },
  { key: 'sheenColorMap', label: 'Sheen color', short: 'Sheen', srgb: true },
  { key: 'displacementMap', label: 'Displacement', short: 'Disp', srgb: false },
];

export const MATERIAL_PRESETS = {
  clay: {
    label: 'Matte clay',
    state: { color: '#c9bfb2', metalness: 0, roughness: 0.86, clearcoat: 0, transmission: 0, ior: 1.45, envMapIntensity: 0.8 },
  },
  ceramic: {
    label: 'Ceramic',
    state: { color: '#f2efe8', metalness: 0, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.12, transmission: 0, envMapIntensity: 1.1 },
  },
  chrome: {
    label: 'Chrome',
    state: { color: '#e9eaee', metalness: 1, roughness: 0.06, clearcoat: 0.4, transmission: 0, envMapIntensity: 1.5 },
  },
  gold: {
    label: 'Gold',
    state: { color: '#ffcf8a', metalness: 1, roughness: 0.17, clearcoat: 0.2, transmission: 0, envMapIntensity: 1.4 },
  },
  copper: {
    label: 'Copper',
    state: { color: '#e0a184', metalness: 1, roughness: 0.24, transmission: 0, envMapIntensity: 1.3 },
  },
  obsidian: {
    label: 'Obsidian',
    state: { color: '#0d0d10', metalness: 0.15, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, transmission: 0, envMapIntensity: 1.3 },
  },
  glass: {
    label: 'Clear glass',
    state: { color: '#ffffff', metalness: 0, roughness: 0.035, transmission: 1, thickness: 0.9, ior: 1.5, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4, transparent: false },
  },
  frosted: {
    label: 'Frosted glass',
    state: { color: '#eef3f8', metalness: 0, roughness: 0.42, transmission: 0.95, thickness: 1.2, ior: 1.48, clearcoat: 0.4, envMapIntensity: 1.2 },
  },
  water: {
    label: 'Water',
    state: { color: '#bfe6f2', metalness: 0, roughness: 0.06, transmission: 1, thickness: 2.2, ior: 1.333, envMapIntensity: 1.4 },
  },
  neon: {
    label: 'Neon',
    state: { color: '#0d0d12', metalness: 0.2, roughness: 0.35, emissive: '#7cf5ff', emissiveIntensity: 4.2, envMapIntensity: 0.6 },
  },
  wax: {
    label: 'Wax',
    state: { color: '#f3d9c6', metalness: 0, roughness: 0.45, transmission: 0.55, thickness: 1.4, ior: 1.44, sheen: 0.6, sheenColor: '#ffd9c4', envMapIntensity: 1 },
  },
  fabric: {
    label: 'Fabric',
    state: { color: '#b7b2aa', metalness: 0, roughness: 0.95, sheen: 1, sheenColor: '#ffffff', sheenRoughness: 0.6, transmission: 0, envMapIntensity: 0.7 },
  },
  hologram: {
    label: 'Hologram',
    state: { color: '#6ee7ff', metalness: 0.4, roughness: 0.18, transmission: 0.75, thickness: 0.4, ior: 1.6, iridescence: 1, iridescenceIOR: 1.8, emissive: '#0b3d4d', emissiveIntensity: 1.4, envMapIntensity: 1.4 },
  },
};

export function materialStateFromPreset(name = 'clay', extra = {}) {
  const preset = MATERIAL_PRESETS[name] || MATERIAL_PRESETS.clay;
  return {
    preset: MATERIAL_PRESETS[name] ? name : 'custom',
    name: preset.label,
    color: '#ffffff',
    metalness: 0,
    roughness: 0.5,
    emissive: '#000000',
    emissiveIntensity: 1,
    transmission: 0,
    thickness: 0.5,
    ior: 1.5,
    clearcoat: 0,
    clearcoatRoughness: 0.1,
    sheen: 0,
    sheenColor: '#ffffff',
    sheenRoughness: 0.5,
    iridescence: 0,
    iridescenceIOR: 1.3,
    anisotropy: 0,
    opacity: 1,
    transparent: false,
    wireframe: false,
    flatShading: false,
    vertexColors: false,
    side: 'front',
    envMapIntensity: 1,
    normalScale: 1,
    aoMapIntensity: 1,
    ...preset.state,
    ...extra,
  };
}

export function convertToPhysical(material) {
  if (!material || material.isMeshPhysicalMaterial) return material;
  if (!material.isMeshStandardMaterial) return material;
  const phys = new THREE.MeshPhysicalMaterial();

  // Copy the standard-material surface by hand. MeshPhysicalMaterial.copy()
  // assumes physical-only members (clearcoatNormalScale, sheenColor, …) exist,
  // which a plain MeshStandardMaterial does not have.
  const colorKeys = ['color', 'emissive', 'specularColor', 'sheenColor', 'attenuationColor'];
  const vec2Keys = ['normalScale', 'clearcoatNormalScale'];
  for (const key of colorKeys) {
    if (material[key]?.isColor && phys[key]?.isColor) phys[key].copy(material[key]);
  }
  for (const key of vec2Keys) {
    if (material[key]?.isVector2 && phys[key]?.isVector2) phys[key].copy(material[key]);
  }
  const direct = [
    'name', 'roughness', 'metalness', 'opacity', 'alphaTest', 'transparent', 'side',
    'flatShading', 'wireframe', 'vertexColors', 'envMapIntensity', 'aoMapIntensity',
    'emissiveIntensity', 'depthWrite', 'depthTest', 'depthFunc', 'blending', 'blendSrc',
    'blendDst', 'blendEquation', 'premultipliedAlpha', 'polygonOffset', 'polygonOffsetFactor',
    'polygonOffsetUnits', 'dithering', 'toneMapped', 'visible', 'fog', 'shadowSide',
    'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
    'alphaMap', 'envMap', 'lightMap', 'bumpMap', 'displacementMap', 'displacementScale',
    'displacementBias', 'alphaHash', 'forceSinglePass',
  ];
  for (const key of direct) {
    if (material[key] !== undefined) phys[key] = material[key];
  }
  phys.userData = { ...(material.userData || {}) };
  if (material.defines) phys.defines = { ...material.defines };
  if (material.normalScale && !phys.normalScale) phys.normalScale = material.normalScale.clone();
  return phys;
}

const SIDE = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide };

export function applyMaterialState(material, state, resolveTexture = null) {
  if (!material || !state) return;
  const m = convertToPhysical(material);
  if (state.preset) m.userData.preset = state.preset;
  if (m.color && state.color) m.color.set(state.color);
  if (state.metalness !== undefined) m.metalness = state.metalness;
  if (state.roughness !== undefined) m.roughness = state.roughness;
  if (state.emissive && m.emissive) m.emissive.set(state.emissive);
  if (state.emissiveIntensity !== undefined) m.emissiveIntensity = state.emissiveIntensity;
  if (state.transmission !== undefined) m.transmission = state.transmission;
  if (state.thickness !== undefined) m.thickness = state.thickness;
  if (state.ior !== undefined) m.ior = state.ior;
  if (state.clearcoat !== undefined) m.clearcoat = state.clearcoat;
  if (state.clearcoatRoughness !== undefined) m.clearcoatRoughness = state.clearcoatRoughness;
  if (state.sheen !== undefined) m.sheen = state.sheen;
  if (state.sheenColor && m.sheenColor) m.sheenColor.set(state.sheenColor);
  if (state.sheenRoughness !== undefined) m.sheenRoughness = state.sheenRoughness;
  if (state.iridescence !== undefined) m.iridescence = state.iridescence;
  if (state.iridescenceIOR !== undefined) m.iridescenceIOR = state.iridescenceIOR;
  if (state.anisotropy !== undefined) m.anisotropy = state.anisotropy;
  if (state.envMapIntensity !== undefined) m.envMapIntensity = state.envMapIntensity;
  if (state.opacity !== undefined) {
    m.opacity = state.opacity;
    m.transparent = state.transparent || state.opacity < 0.999;
  }
  if (state.normalScale !== undefined && m.normalScale) m.normalScale.set(state.normalScale, state.normalScale);
  if (state.aoMapIntensity !== undefined && m.aoMapIntensity !== undefined) m.aoMapIntensity = state.aoMapIntensity;
  if (state.wireframe !== undefined) m.wireframe = !!state.wireframe;
  if (state.flatShading !== undefined && m.flatShading !== state.flatShading) {
    m.flatShading = !!state.flatShading;
    m.needsUpdate = true;
  }
  if (state.vertexColors !== undefined && m.vertexColors !== state.vertexColors) {
    m.vertexColors = !!state.vertexColors;
    m.needsUpdate = true;
  }
  if (state.side && SIDE[state.side] !== undefined) m.side = SIDE[state.side];
  if (state.depthWrite !== undefined) m.depthWrite = state.depthWrite;
  if (state.maps && resolveTexture) {
    m.userData.texIds = m.userData.texIds || {};
    for (const [slot, id] of Object.entries(state.maps)) {
      if (!(slot in m) && slot !== 'map') continue;
      if (id === null) {
        m[slot] = null;
        m.userData.texIds[slot] = null;
      } else if (typeof id === 'string') {
        const tex = resolveTexture(id);
        if (tex) {
          const slotInfo = TEXTURE_SLOTS.find((s) => s.key === slot);
          tex.colorSpace = slotInfo?.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          m[slot] = tex;
          m.userData.texIds[slot] = id;
          if (slot === 'alphaMap' || slot === 'map') {
            // alphaMap expects green channel; three handles it.
          }
          if (state.uv) {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(state.uv.repeat?.[0] ?? 1, state.uv.repeat?.[1] ?? 1);
            tex.offset.set(state.uv.offset?.[0] ?? 0, state.uv.offset?.[1] ?? 0);
            tex.rotation = state.uv.rotation ?? 0;
            tex.needsUpdate = true;
          }
        }
      }
    }
  }
  m.needsUpdate = true;
}

export function readMaterialState(material) {
  if (!material) return null;
  const maps = {};
  const texIds = material.userData?.texIds || {};
  for (const slot of TEXTURE_SLOTS) {
    if (!(slot.key in material)) continue;
    const tex = material[slot.key];
    if (!tex) {
      if (slot.key in texIds) maps[slot.key] = null;
      continue;
    }
    maps[slot.key] = texIds[slot.key] || tex.userData?.assetId || null;
    if (maps[slot.key] === null) delete maps[slot.key];
  }
  return {
    preset: material.userData?.preset || 'custom',
    name: material.name || '',
    color: `#${new THREE.Color(material.color || 0xffffff).getHexString()}`,
    metalness: material.metalness ?? 0,
    roughness: material.roughness ?? 0.5,
    emissive: material.emissive ? `#${material.emissive.getHexString()}` : '#000000',
    emissiveIntensity: material.emissiveIntensity ?? 1,
    transmission: material.transmission ?? 0,
    thickness: material.thickness ?? 0,
    ior: material.ior ?? 1.5,
    clearcoat: material.clearcoat ?? 0,
    clearcoatRoughness: material.clearcoatRoughness ?? 0,
    sheen: material.sheen ?? 0,
    sheenColor: material.sheenColor ? `#${material.sheenColor.getHexString()}` : '#ffffff',
    sheenRoughness: material.sheenRoughness ?? 0.5,
    iridescence: material.iridescence ?? 0,
    iridescenceIOR: material.iridescenceIOR ?? 1.3,
    anisotropy: material.anisotropy ?? 0,
    opacity: material.opacity ?? 1,
    transparent: !!material.transparent,
    wireframe: !!material.wireframe,
    flatShading: !!material.flatShading,
    vertexColors: !!material.vertexColors,
    side: material.side === THREE.BackSide ? 'back' : material.side === THREE.DoubleSide ? 'double' : 'front',
    envMapIntensity: material.envMapIntensity ?? 1,
    normalScale: material.normalScale?.x ?? 1,
    aoMapIntensity: material.aoMapIntensity ?? 1,
    maps,
    uv: {
      repeat: [material.map?.repeat.x ?? 1, material.map?.repeat.y ?? 1],
      offset: [material.map?.offset.x ?? 0, material.map?.offset.y ?? 0],
      rotation: material.map?.rotation ?? 0,
    },
  };
}

export function collectMaterials(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => out.push({ object: o, material: m, multi: Array.isArray(o.material) }));
  });
  return out;
}

export function disposeMaterial(m) {
  if (!m) return;
  m.dispose?.();
}
