import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../app.js';
import { debounce, rad } from './util.js';

const gradientCache = new Map();

function gradientTexture(top = '#dfe6ee', bottom = '#8d949e', size = 512) {
  const key = `${top}|${bottom}|${size}`;
  if (gradientCache.has(key)) return gradientCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, top);
  g.addColorStop(0.46, top);
  g.addColorStop(0.5, bottom);
  g.addColorStop(0.54, bottom);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.generated = true;
  gradientCache.set(key, tex);
  return tex;
}

function sunDirection(elevation = 12, azimuth = 180) {
  const phi = rad(90 - elevation);
  const theta = rad(azimuth);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

export class Environment {
  constructor(scene, renderer, engine) {
    this.scene = scene;
    this.renderer = renderer;
    this.engine = engine;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.hdriTexture = null;
    this.state = null;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);
    this.lightGroup = new THREE.Group();
    this.group.add(this.lightGroup);
    this.groundMesh = null;
    this.skyMesh = null;
    this._bgTexture = null;
    this.scheduleEnv = debounce(() => this.buildEnvMap(), 160);
    this._lastEnvKey = '';
  }

  apply(state, settings, { immediate = true } = {}) {
    this.state = state;
    this.settings = settings;
    const st = state;

    // ── fog ──
    if (st.fog?.enabled) {
      this.scene.fog = new THREE.FogExp2(new THREE.Color(st.fog.color ?? '#9aa0a6'), st.fog.density ?? 0.012);
    } else {
      this.scene.fog = null;
    }

    // ── background ──
    this._applyBackground(st);

    // ── sky mesh ──
    this._applySky(st);

    // ── ground ──
    this._applyGround(st);

    // ── lights ──
    this._applyLights(st);

    // ── environment IBL ──
    this.scene.environmentIntensity = st.envIntensity ?? 1;
    if (immediate) this.buildEnvMap();
    else this.scheduleEnv();

    this.renderer.toneMappingExposure = st.exposure ?? 1;
  }

  _clearSky() {
    if (this.skyMesh) {
      this.group.remove(this.skyMesh);
      this.skyMesh.geometry.dispose();
      this.skyMesh.material.dispose();
      this.skyMesh = null;
    }
  }

  _makeSky(params = {}) {
    const sky = new Sky();
    sky.scale.setScalar(2500);
    sky.material.depthWrite = false;
    sky.material.depthTest = false;
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    const u = sky.material.uniforms;
    u.turbidity.value = params.turbidity ?? 3.5;
    u.rayleigh.value = params.rayleigh ?? 1.2;
    u.mieCoefficient.value = params.mieCoefficient ?? 0.0045;
    u.mieDirectionalG.value = params.mieDirectionalG ?? 0.82;
    const d = sunDirection(params.sunElevation ?? 14, params.sunAzimuth ?? 190);
    u.sunPosition.value.copy(d.multiplyScalar(1000));
    return sky;
  }

  getSunDirection() {
    const s = this.state?.sky || {};
    return sunDirection(s.sunElevation ?? 14, s.sunAzimuth ?? 190);
  }

  _applySky(st) {
    this._clearSky();
    const type = st.background?.type || 'sky';
    if (type === 'sky') {
      const sky = this._makeSky(st.sky);
      this.skyMesh = sky;
      this.group.add(sky);
      this.scene.background = null;
    }
  }

  _applyBackground(st) {
    const bg = st.background || { type: 'color', color: '#0c0c10' };
    const old = this._bgTexture;
    this._bgTexture = null;

    if (bg.type === 'sky') {
      // sky mesh handles it
      if (this.scene.background !== null) this.scene.background = null;
    } else if (bg.type === 'gradient') {
      const tex = gradientTexture(bg.top, bg.bottom);
      this._bgTexture = tex;
      this.scene.background = tex;
      this.scene.backgroundIntensity = 1;
    } else if (bg.type === 'hdri' && this.hdriTexture) {
      this.scene.background = this.hdriTexture;
      this.scene.backgroundBlurriness = 0;
    } else {
      this.scene.background = new THREE.Color(bg.color || '#0b0b0f');
    }
    this.scene.backgroundBlurriness = bg.blur ?? 0;
    if (old && old !== this.scene.background && old.userData?.generated && old !== this.hdriTexture) {
      if (![...gradientCache.values()].includes(old)) old.dispose();
    }
    if (this.scene.background?.isColor) this.scene.backgroundBlurriness = 0;
  }

  _applyGround(st) {
    const g = st.ground || {};
    if (!g.enabled) {
      if (this.groundMesh) {
        this.group.remove(this.groundMesh);
        this.groundMesh.geometry.dispose();
        this.groundMesh.material.dispose();
        this.groundMesh = null;
      }
      return;
    }
    const size = g.size ?? 260;
    const key = `${size}|${g.segments ?? 96}`;
    if (!this.groundMesh || this._groundKey !== key) {
      if (this.groundMesh) {
        this.group.remove(this.groundMesh);
        this.groundMesh.geometry.dispose();
        this.groundMesh.material.dispose();
      }
      const geo = new THREE.CircleGeometry(size / 2, g.segments ?? 96);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(g.color ?? '#202024'),
        roughness: g.roughness ?? 0.9,
        metalness: g.metalness ?? 0.0,
        envMapIntensity: g.envMapIntensity ?? 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.name = '__ground';
      mesh.userData.isEnvironment = true;
      mesh.renderOrder = -1;
      this.group.add(mesh);
      this.groundMesh = mesh;
      this._groundKey = key;
    } else {
      const mat = this.groundMesh.material;
      mat.color.set(g.color ?? '#202024');
      mat.roughness = g.roughness ?? 0.9;
      mat.metalness = g.metalness ?? 0.0;
      mat.envMapIntensity = g.envMapIntensity ?? 1;
    }
    this.groundMesh.position.y = g.y ?? 0;
    this.groundMesh.visible = g.visible !== false;
  }

  _applyLights(st) {
    while (this.lightGroup.children.length) {
      const c = this.lightGroup.children.shift();
      this.lightGroup.remove(c);
      c.dispose?.();
      if (c.shadow?.map) c.shadow.map.dispose();
    }
    const shadows = this.settings?.shadows !== false;
    const q = QUALITY[this.settings?.quality] || QUALITY.high;
    const shadowSize = Math.min(2048, q.shadow);

    // sun
    const sunDir = this.getSunDirection();
    const sun = new THREE.DirectionalLight(new THREE.Color(st.sun?.color ?? '#fff2e0'), st.sun?.intensity ?? 3);
    sun.position.copy(sunDir).multiplyScalar(80);
    sun.castShadow = shadows && st.sun?.shadows !== false;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 260;
    const extent = st.sun?.shadowExtent ?? 55;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.2;
    const target = new THREE.Object3D();
    target.position.set(0, 0, 0);
    this.lightGroup.add(target);
    sun.target = target;
    this.lightGroup.add(sun);
    this.sun = sun;

    // ambient sky fill
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(st.hemi?.sky ?? '#ccd7ff'),
      new THREE.Color(st.hemi?.ground ?? '#3a3228'),
      st.hemi?.intensity ?? 0.55
    );
    hemi.position.set(0, 30, 0);
    this.lightGroup.add(hemi);

    // extra lights
    for (const l of st.lights || []) {
      let light;
      if (l.type === 'point') {
        light = new THREE.PointLight(new THREE.Color(l.color || '#ffffff'), l.intensity ?? 8, l.distance ?? 0, l.decay ?? 2);
      } else if (l.type === 'spot') {
        light = new THREE.SpotLight(
          new THREE.Color(l.color || '#ffffff'),
          l.intensity ?? 20,
          l.distance ?? 0,
          rad(l.angle ?? 45),
          l.penumbra ?? 0.5,
          l.decay ?? 2
        );
        const t = new THREE.Object3D();
        t.position.set(...(l.target || [0, 0, 0]));
        this.lightGroup.add(t);
        light.target = t;
      } else if (l.type === 'directional') {
        light = new THREE.DirectionalLight(new THREE.Color(l.color || '#ffffff'), l.intensity ?? 1.5);
      } else if (l.type === 'hemi') {
        light = new THREE.HemisphereLight(new THREE.Color(l.color || '#ffffff'), new THREE.Color(l.ground || '#222222'), l.intensity ?? 0.4);
      } else {
        light = new THREE.AmbientLight(new THREE.Color(l.color || '#ffffff'), l.intensity ?? 0.2);
      }
      light.position.set(...(l.position || [0, 3, 0]));
      light.userData.lightId = l.id;
      if (shadows && l.castShadow && (light.isPointLight || light.isSpotLight)) {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.002;
      }
      this.lightGroup.add(light);
    }
  }

  buildEnvMap() {
    const st = this.state;
    if (!st) return;
    const settings = this.settings || {};
    const key = JSON.stringify({
      b: st.background, s: st.sky, sun: st.sun, g: st.ground, mode: st.mode,
      env: st.envIntensity, hid: this.hdriTexture?.uuid,
    });
    if (key === this._lastEnvKey) return;
    this._lastEnvKey = key;

    let rt = null;
    try {
      if (this.hdriTexture && st.background?.type === 'hdri') {
        rt = this.pmrem.fromEquirectangular(this.hdriTexture);
      } else if (st.mode === 'studio') {
        const room = new RoomEnvironment();
        rt = this.pmrem.fromScene(room, 0.04, 0.1, 100);
        room.traverse((o) => {
          o.geometry?.dispose?.();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material.dispose();
          }
        });
      } else if (st.mode === 'outdoor' || st.background?.type === 'sky') {
        const envScene = new THREE.Scene();
        const sky = this._makeSky(st.sky);
        sky.material.depthTest = true;
        sky.scale.setScalar(800);
        envScene.add(sky);
        // warm bounce from the ground
        const bounce = new THREE.Mesh(
          new THREE.SphereGeometry(600, 16, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(st.ground?.color || '#39322c'), side: THREE.BackSide })
        );
        envScene.add(bounce);
        rt = this.pmrem.fromScene(envScene, 0.02, 1, 900);
        sky.geometry.dispose();
        sky.material.dispose();
        bounce.geometry.dispose();
        bounce.material.dispose();
      } else if (st.background?.type === 'gradient') {
        const tex = gradientTexture(st.background.top, st.background.bottom);
        rt = this.pmrem.fromEquirectangular(tex);
      } else {
        const room = new RoomEnvironment();
        rt = this.pmrem.fromScene(room, 0.04, 0.1, 100);
        room.traverse((o) => {
          o.geometry?.dispose?.();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => m.dispose?.());
          }
        });
      }
    } catch (err) {
      console.warn('[env] PMREM failed', err);
    }
    if (!rt) return;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = st.envIntensity ?? 1;
    void settings;
  }

  setHDRI(texture) {
    this.hdriTexture = texture;
    this._lastEnvKey = '';
    if (this.state) {
      this.state.background = { type: 'hdri', name: texture.name || 'HDRI' };
      this.apply(this.state, this.settings, { immediate: true });
    }
  }

  clearHDRI() {
    this.hdriTexture = null;
    this._lastEnvKey = '';
  }

  refresh() {
    this._lastEnvKey = '';
    this.buildEnvMap();
  }

  dispose() {
    this._clearSky();
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.fog = null;
    this.envRT?.dispose();
    this.pmrem.dispose();
    this._applyLights({});
  }
}
