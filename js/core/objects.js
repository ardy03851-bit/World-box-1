import * as THREE from 'three';
import { makeNoise2D, fbm, ridged, clamp, rad } from './util.js';
import {
  applyMaterialState,
  materialStateFromPreset,
  convertToPhysical,
  collectMaterials,
} from './materials.js';

export const PRIMITIVES = [
  { type: 'sphere', label: 'Sphere', icon: 'sphere', params: { radius: 1, widthSegments: 64, heightSegments: 40 } },
  { type: 'cube', label: 'Box', icon: 'cube', params: { width: 1.4, height: 1.4, depth: 1.4, segments: 1 } },
  { type: 'cylinder', label: 'Cylinder', icon: 'cylinder', params: { radiusTop: 0.7, radiusBottom: 0.7, height: 2, segments: 64 } },
  { type: 'cone', label: 'Cone', icon: 'cone', params: { radius: 0.9, height: 2, segments: 64 } },
  { type: 'capsule', label: 'Capsule', icon: 'capsule', params: { radius: 0.55, height: 1.6, capSegments: 16, radialSegments: 48 } },
  { type: 'torus', label: 'Torus', icon: 'torus', params: { radius: 1, tube: 0.32, radialSegments: 48, tubularSegments: 128 } },
  { type: 'torusKnot', label: 'Knot', icon: 'torus', params: { radius: 0.9, tube: 0.26, tubularSegments: 200, radialSegments: 32, p: 2, q: 3 } },
  { type: 'plane', label: 'Plane', icon: 'grid', params: { width: 3, height: 3, segments: 1 } },
  { type: 'icosahedron', label: 'Icosa', icon: 'sphere', params: { radius: 1, detail: 1 } },
  { type: 'octahedron', label: 'Gem', icon: 'gem', params: { radius: 1, detail: 0 } },
  { type: 'dodecahedron', label: 'Dodeca', icon: 'sphere', params: { radius: 1, detail: 0 } },
  { type: 'ring', label: 'Ring', icon: 'torus', params: { innerRadius: 0.6, outerRadius: 1, segments: 96 } },
  { type: 'shard', label: 'Shard', icon: 'gem', params: { radius: 0.8, height: 3.4, sides: 5 } },
];

export function primitiveGeometry(type, p = {}) {
  switch (type) {
    case 'sphere':
      return new THREE.SphereGeometry(p.radius ?? 1, p.widthSegments ?? 64, p.heightSegments ?? 40);
    case 'cube':
      return new THREE.BoxGeometry(p.width ?? 1.4, p.height ?? 1.4, p.depth ?? 1.4, p.segments ?? 1, p.segments ?? 1, p.segments ?? 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(p.radiusTop ?? 0.7, p.radiusBottom ?? 0.7, p.height ?? 2, p.segments ?? 64, 1, !!p.openEnded);
    case 'cone':
      return new THREE.ConeGeometry(p.radius ?? 0.9, p.height ?? 2, p.segments ?? 64);
    case 'capsule':
      return new THREE.CapsuleGeometry(p.radius ?? 0.55, p.height ?? 1.6, p.capSegments ?? 16, p.radialSegments ?? 48);
    case 'torus':
      return new THREE.TorusGeometry(p.radius ?? 1, p.tube ?? 0.32, p.radialSegments ?? 48, p.tubularSegments ?? 128);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(p.radius ?? 0.9, p.tube ?? 0.26, p.tubularSegments ?? 200, p.radialSegments ?? 32, p.p ?? 2, p.q ?? 3);
    case 'plane':
      return new THREE.PlaneGeometry(p.width ?? 3, p.height ?? 3, p.segments ?? 1, p.segments ?? 1);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(p.radius ?? 1, p.detail ?? 1);
    case 'octahedron':
      return new THREE.OctahedronGeometry(p.radius ?? 1, p.detail ?? 0);
    case 'dodecahedron':
      return new THREE.DodecahedronGeometry(p.radius ?? 1, p.detail ?? 0);
    case 'ring':
      return new THREE.RingGeometry(p.innerRadius ?? 0.6, p.outerRadius ?? 1, p.segments ?? 96);
    case 'shard': {
      const geo = new THREE.CylinderGeometry(p.sides ? p.radius * 0.12 : 0, p.radius ?? 0.8, p.height ?? 3.4, p.sides ?? 5, 3);
      geo.translate(0, (p.height ?? 3.4) / 2, 0);
      return geo;
    }
    default:
      return new THREE.SphereGeometry(1, 48, 32);
  }
}

export function createPrimitive(desc, resolveTexture) {
  const geo = primitiveGeometry(desc.primitive?.type || 'sphere', desc.primitive?.params || {});
  const state = desc.material || materialStateFromPreset('clay');
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  applyMaterialState(mat, state, resolveTexture);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = desc.name || 'Object';
  mesh.userData.kind = 'primitive';
  if (desc.material?.id) mat.userData.originId = desc.material.id;
  return mesh;
}

export function buildTerrainGeometry(t = {}) {
  const size = clamp(t.size ?? 130, 6, 900);
  const res = clamp(Math.round(t.resolution ?? 150), 8, 360);
  const amp = t.amp ?? 3.4;
  const freq = t.freq ?? 1;
  const octaves = clamp(Math.round(t.octaves ?? 5), 1, 8);
  const seed = t.seed ?? 7;
  const geo = new THREE.PlaneGeometry(size, size, res, res);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const n = makeNoise2D(seed);
  const n2 = makeNoise2D(seed + 91);
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nx = x * 0.018 * freq;
    const nz = z * 0.018 * freq;
    let h;
    if (t.ridged) {
      h = (ridged(n, nx + 20, nz + 9, octaves) - 0.35) * amp * 1.9;
    } else {
      h = (fbm(n, nx + 20, nz + 9, octaves, 2.03, 0.52) - 0.5) * 2 * amp;
      h += (fbm(n2, nx * 2.6, nz * 2.6, Math.max(2, octaves - 2)) - 0.5) * amp * 0.35;
    }
    // soften the rim so terrain melts into the horizon
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (size * 0.5);
    const rim = 1 - Math.max(0, Math.min(1, (edge - 0.72) / 0.28));
    h *= rim;
    pos.setY(i, h);

    const shade = 0.78 + fbm(n2, nx * 6 + 3, nz * 6 - 4, 3) * 0.36;
    const ao = 0.72 + clamp(h / Math.max(0.001, amp), -1, 1) * 0.16;
    const v = clamp(shade * ao, 0.35, 1.3);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export function createTerrain(desc, resolveTexture) {
  const t = desc.terrain || {};
  const group = new THREE.Group();
  group.name = desc.name || 'Terrain';

  const geo = buildTerrainGeometry(t);
  const state = { ...materialStateFromPreset('clay'), vertexColors: true, ...(desc.material || {}) };
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  applyMaterialState(mat, state, resolveTexture);
  mat.vertexColors = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `${group.name} mesh`;
  mesh.userData.isTerrainMesh = true;
  group.add(mesh);

  if (t.water?.enabled) {
    const w = t.water;
    const wgeo = new THREE.CircleGeometry((t.size ?? 130) * 0.49, 96);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(w.color || '#2e6f82'),
      roughness: w.roughness ?? 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: w.opacity ?? 0.86,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(wgeo, wmat);
    water.position.y = w.level ?? 0;
    water.receiveShadow = true;
    water.name = 'Water';
    water.userData.isWater = true;
    group.add(water);
  }

  group.userData.kind = 'terrain';
  return group;
}

export function createLightObject(desc) {
  const l = desc.light || {};
  const color = new THREE.Color(l.color || '#ffffff');
  const intensity = l.intensity ?? 3;
  let light;
  switch (l.type) {
    case 'point':
      light = new THREE.PointLight(color, intensity, l.distance ?? 0, l.decay ?? 2);
      break;
    case 'spot':
      light = new THREE.SpotLight(color, intensity, l.distance ?? 0, rad(l.angle ?? 42), l.penumbra ?? 0.45, l.decay ?? 2);
      break;
    case 'hemi':
      light = new THREE.HemisphereLight(color, new THREE.Color(l.groundColor || '#26262c'), intensity);
      break;
    case 'ambient':
      light = new THREE.AmbientLight(color, intensity);
      break;
    default:
      light = new THREE.DirectionalLight(color, intensity);
  }
  light.castShadow = l.castShadow !== false && (light.isSpotLight || light.isDirectionalLight || light.isPointLight);
  if (light.shadow) {
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0015;
    light.shadow.normalBias = 0.03;
    if (light.isSpotLight) {
      light.distance = l.distance ?? 0;
      light.angle = rad(l.angle ?? 42);
      light.penumbra = l.penumbra ?? 0.45;
    }
    if (light.isPointLight) light.shadow.camera.far = l.distance || 80;
    if (light.isDirectionalLight) {
      light.shadow.camera.left = -30;
      light.shadow.camera.right = 30;
      light.shadow.camera.top = 30;
      light.shadow.camera.bottom = -30;
      light.shadow.camera.far = 160;
    }
  }
  if (light.isSpotLight || light.isDirectionalLight) {
    const target = new THREE.Object3D();
    target.position.set(0, 0, -1);
    light.add(target);
    light.target = target;
  }
  light.name = desc.name || `${l.type || 'light'} light`;
  light.userData.kind = 'light';
  return light;
}

export function instantiateAsset(template, desc, resolveTexture, SkeletonClone) {
  let root;
  try {
    root = SkeletonClone ? SkeletonClone(template) : template.clone(true);
  } catch (e) {
    console.warn('[asset] clone failed, falling back', e);
    root = template.clone(true);
  }
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        const cloneMat = (m) => {
          const c = convertToPhysical(m.clone());
          c.userData = { ...m.userData };
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
      }
      if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    }
    if (o.isCamera) o.visible = false;
  });

  // apply saved material states, matched by traversal order
  if (desc.materials && desc.materials.length) {
    const mats = collectMaterials(root);
    desc.materials.forEach((state, i) => {
      if (!state) return;
      const entry = mats[i];
      if (entry) applyMaterialState(entry.material, state, resolveTexture);
    });
  }
  // name meshes for the inspector
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      if (o.material && !o.material.name) o.material.name = o.name || 'Material';
    }
  });
  root.userData.kind = 'asset';
  return root;
}

export function computeBounds(root) {
  const box = new THREE.Box3().setFromObject(root);
  return box;
}

export function dropToFloor(root, groundY = 0) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const delta = groundY - box.min.y;
  root.position.y += delta;
}

export function normalizeAsset(root, targetSize = 2) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return root;
  const size = box.getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z);
  if (!isFinite(max) || max <= 0) return root;
  // only rescale absurd extremes; most exports are already in sensible units
  if (max > 40 || max < 0.06) {
    const s = targetSize / max;
    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);
  }
  return root;
}
