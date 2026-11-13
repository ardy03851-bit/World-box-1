import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { clamp, debounce, lerp, rad } from './util.js';
import { emit } from '../bus.js';
import { app, QUALITY } from '../app.js';

const TONE_MAP = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  linear: THREE.LinearToneMapping,
};
const TONE_INDEX = { linear: 0, aces: 1, agx: 2, neutral: 3, reinhard: 4, cineon: 5 };

const GradeShader = {
  name: 'WorldboxGrade',
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uTone: { value: 1 },
    uContrast: { value: 0.05 },
    uSaturation: { value: 0.0 },
    uTemperature: { value: 0.0 },
    uTint: { value: 0.0 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.02 },
    uChroma: { value: 0.0 },
    uTime: { value: 0.0 },
    uLetterbox: { value: 0.0 },
    uFade: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(0, 0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uExposure, uContrast, uSaturation, uTemperature, uTint, uVignette, uGrain, uChroma, uTime, uLetterbox, uFade;
    uniform int uTone;
    uniform vec2 uResolution;
    uniform vec3 uHighlightTint, uShadowTint;

    vec3 acesFilm( vec3 color ) {
      const mat3 ACESInputMat = mat3(
        vec3( 0.59719, 0.07600, 0.02840 ),
        vec3( 0.35458, 0.90834, 0.13383 ),
        vec3( 0.04823, 0.01566, 0.83777 )
      );
      const mat3 ACESOutputMat = mat3(
        vec3(  1.60475, -0.10208, -0.00327 ),
        vec3( -0.53108,  1.10813, -0.07276 ),
        vec3( -0.07367, -0.00605,  1.07602 )
      );
      color = ACESInputMat * color;
      vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
      vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
      color = a / b;
      color = ACESOutputMat * color;
      return clamp( color, 0.0, 1.0 );
    }

    vec3 agxFilm( vec3 color ) {
      const mat3 In = mat3(
        vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
      );
      const mat3 Out = mat3(
        vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
      );
      const mat3 toRec2020 = mat3(
        vec3(0.6274, 0.0691, 0.0164),
        vec3(0.3293, 0.9195, 0.0880),
        vec3(0.0433, 0.0113, 0.8956)
      );
      const mat3 toSrgb = mat3(
        vec3(1.6605, -0.1246, -0.0182),
        vec3(-0.5876, 1.1329, -0.1006),
        vec3(-0.0728, -0.0083, 1.1187)
      );
      color = toRec2020 * color;
      color = In * color;
      color = max( color, vec3( 1e-10 ) );
      color = log2( color );
      color = ( color + 12.47393 ) / ( 16.5 );
      color = clamp( color, 0.0, 1.0 );
      vec3 x2 = color * color;
      vec3 x4 = x2 * x2;
      color = 15.5 * x4 * x2 - 40.14 * x4 * color + 31.96 * x4 - 6.868 * x2 * color + 0.4298 * x2 + 0.1191 * color - 0.00232;
      color = Out * color;
      color = pow( max( vec3(0.0), color ), vec3(2.2) );
      color = toSrgb * color;
      return clamp( color, 0.0, 1.0 );
    }

    vec3 neutralFilm( vec3 color ) {
      const float StartCompression = 0.8 - 0.04;
      const float Desaturation = 0.15;
      float x = min( color.r, min( color.g, color.b ) );
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max( color.r, max( color.g, color.b ) );
      if ( peak < StartCompression ) return color;
      float d = 1.0 - StartCompression;
      float newPeak = 1.0 - d * d / ( peak + d - StartCompression );
      color *= newPeak / peak;
      float g = 1.0 - 1.0 / ( Desaturation * ( peak - newPeak ) + 1.0 );
      return mix( color, vec3( newPeak ), g );
    }

    vec3 linearToSRGB( vec3 c ) {
      vec3 lo = c * 12.92;
      vec3 hi = 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055;
      return mix( hi, lo, step( c, vec3( 0.0031308 ) ) );
    }

    float hash( vec2 p ) {
      return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
    }

    void main() {
      vec2 uv = vUv;
      if ( uv.y < uLetterbox || uv.y > 1.0 - uLetterbox ) {
        gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
        return;
      }

      vec3 col;
      if ( uChroma > 0.0001 ) {
        vec2 dir = ( uv - 0.5 ) * uChroma * 0.0022;
        float r = texture2D( tDiffuse, uv + dir ).r;
        float g = texture2D( tDiffuse, uv ).g;
        float b = texture2D( tDiffuse, uv - dir ).b;
        col = vec3( r, g, b );
      } else {
        col = texture2D( tDiffuse, uv ).rgb;
      }

      col *= uExposure;

      if ( uTone == 1 ) col = acesFilm( col * 1.0 / 0.6 );
      else if ( uTone == 2 ) col = agxFilm( col );
      else if ( uTone == 3 ) col = neutralFilm( col );
      else if ( uTone == 4 ) col = col / ( 1.0 + col );
      else if ( uTone == 5 ) {
        col = max( vec3( 0.0 ), col - 0.004 );
        col = pow( ( col * ( 6.2 * col + 0.5 ) ) / ( col * ( 6.2 * col + 1.7 ) + 0.06 ), vec3( 2.2 ) );
      }
      col = clamp( col, 0.0, 1.0 );

      col = linearToSRGB( col );

      // white balance
      col.r *= 1.0 + 0.18 * uTemperature;
      col.b *= 1.0 - 0.18 * uTemperature;
      col.g *= 1.0 + 0.10 * uTint;

      // contrast around 0.5
      col = ( col - 0.5 ) * ( 1.0 + uContrast ) + 0.5;

      // saturation
      float luma = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( luma ), col, 1.0 + uSaturation );

      // split tone
      float lum = clamp( luma, 0.0, 1.0 );
      col += uShadowTint * ( 1.0 - lum ) * 0.05;
      col += ( uHighlightTint - vec3( 1.0 ) ) * pow( lum, 2.0 ) * 0.08;

      // vignette
      vec2 c = uv - 0.5;
      float vig = smoothstep( 0.95, 0.28, length( c ) * 1.28 );
      col *= mix( 1.0, vig, uVignette );

      // grain
      float grain = hash( uv * uResolution.xy + uTime * 60.0 ) - 0.5;
      col += grain * uGrain * ( 0.4 + 0.6 * ( 1.0 - luma ) );

      col = mix( col, col * ( 1.0 - uFade ) + uFade * 0.02, 1.0 );

      gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
    }
  `,
};

const GRID_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const GRID_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uCenter;
  uniform vec3 uColor;
  uniform float uOpacity;

  float gridMask( vec2 p, float scale ) {
    vec2 coord = p / scale;
    vec2 g = abs( fract( coord - 0.5 ) - 0.5 ) / max( fwidth( coord ), vec2( 1e-5 ) );
    float line = min( g.x, g.y );
    return 1.0 - min( line, 1.0 );
  }

  void main() {
    float minor = gridMask( vWorld.xz, 1.0 ) * 0.42;
    float major = gridMask( vWorld.xz, 10.0 ) * 0.85;
    float alpha = max( minor, major );
    float dist = length( vWorld.xz - uCenter.xz );
    float fade = 1.0 - smoothstep( 22.0, 110.0, dist );
    alpha *= fade * uOpacity;
    if ( alpha < 0.003 ) discard;
    gl_FragColor = vec4( uColor, alpha );
  }
`;

function buildBrackets() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3 * 2 * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 999;
  lines.frustumCulled = false;
  lines.visible = false;
  lines.userData.isHelper = true;
  return lines;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.04, 6000);
    this.camera.position.set(7, 4.4, 9);
    this.clock = new THREE.Clock();
    this.frameHooks = new Set();
    this.fps = 60;
    this._frames = 0;
    this._fpsTime = performance.now();
    this._frameAvg = 16;
    this._dynScale = 1;
    this._lastQualityCheck = performance.now();
    this._cameraAnim = null;
    this._capturing = false;
    this._running = false;
    this.tone = 'aces';
    this.postState = { post: true, dof: false, msaa: 4 };
    this._lastChainKey = '';
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    renderer.setClearColor(0x07070a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.autoClear = true;
    renderer.info.autoReset = false;
    renderer.transmissionResolutionScale = 0.6;
    this.renderer = renderer;

    this.scene.background = new THREE.Color(0x0a0a0e);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.75;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 420;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.target.set(0, 0.9, 0);
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.update();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.helpers = new THREE.Group();
    this.helpers.name = 'helpers';
    this.scene.add(this.helpers);

    // selection brackets
    this.brackets = buildBrackets();
    this.helpers.add(this.brackets);
    this.hoverBrackets = buildBrackets();
    this.hoverBrackets.material.color.set(0x9ec5ff);
    this.hoverBrackets.material.opacity = 0.95;
    this.hoverBrackets.scale.setScalar(1.02);
    this.helpers.add(this.hoverBrackets);

    // gizmo
    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSize(1.25);
    this.gizmo.setTranslationSnap(null);
    this.gizmo.setRotationSnap(null);
    this.gizmo.setScaleSnap(null);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      app.flags.gizmoDragging = e.value;
      if (e.value) {
        this.gizmo.setSize(1.05);
      } else {
        this.gizmo.setSize(1.25);
        emit('gizmo:commit');
      }
    });
    this.gizmo.addEventListener('objectChange', () => {
      this.updateBrackets();
      emit('gizmo:change');
    });
    this.helpers.add(this.gizmo.getHelper());

    // infinite grid
    const gridGeo = new THREE.PlaneGeometry(600, 600, 1, 1);
    gridGeo.rotateX(-Math.PI / 2);
    this.gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0.16 },
      },
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.grid = new THREE.Mesh(gridGeo, this.gridMat);
    this.grid.position.y = 0.012;
    this.grid.renderOrder = 1;
    this.grid.userData.isHelper = true;
    this.helpers.add(this.grid);

    // post
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.renderPass.clearAlpha = 1;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.34, 0.55, 0.85);
    this.gradePass = new ShaderPass(GradeShader);
    this.gradePass.uniforms.uExposure.value = 1.05;

    this.setupComposer(true);
    this.resize();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 350));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.clock.getDelta();
    });

    this._running = true;
    this._loop();
    return this;
  }

  setupComposer(newTargets = false) {
    if (this.composer) this.composer.dispose();
    const q = QUALITY[this.settings?.quality] || QUALITY.high;
    const msaa = this.postState.msaa ?? q.msaa;
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: msaa,
      depthBuffer: true,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(this.renderPass);
    if (this.postState.dof && !this.bokehPass) {
      const b = new BokehPass(this.scene, this.camera, { focus: 8, aperture: 0.0022, maxblur: 0.01 });
      this.bokehPass = b;
      this.composer.addPass(b);
    } else if (this.postState.dof) {
      this.composer.addPass(this.bokehPass);
    }
    if (this.postState.bloom) this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    this._lastChainKey = this.chainKey();
    this.resize();
  }

  chainKey() {
    return `${this.postState.post}|${this.postState.dof}|${this.postState.bloom}|${this.postState.msaa}`;
  }

  get settings() {
    return app.settings;
  }

  onFrame(fn) {
    this.frameHooks.add(fn);
    return () => this.frameHooks.delete(fn);
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const q = QUALITY[this.settings?.quality] || QUALITY.high;
    const cap = this.settings?.quality === 'auto' ? 2 : q.dpr;
    const base = Math.min(window.devicePixelRatio || 1, cap);
    const pr = base * this._dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) this.bloomPass.setSize(w * pr, h * pr);
    this.gradePass?.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  applyLook(env, settings) {
    const post = env.post || {};
    const grade = env.grade || {};
    const usePost = settings?.post !== false && post.enabled !== false;
    const useBloom = usePost && settings?.bloom !== false && post.bloom !== false;
    const useDof = usePost && (settings?.dof === true || post.dof?.enabled === true);
    const q = QUALITY[settings?.quality] || QUALITY.high;
    const msaa = q.msaa;

    // exposure
    const exposure = env.exposure ?? 1.05;
    this.renderer.toneMappingExposure = exposure;
    this.gradePass.uniforms.uExposure.value = exposure;

    // tone mapping only used by the plain (no-post) renderer path
    this.tone = env.tone || 'aces';
    this.renderer.toneMapping = usePost ? THREE.NoToneMapping : TONE_MAP[this.tone] ?? THREE.ACESFilmicToneMapping;
    this.gradePass.uniforms.uTone.value = TONE_INDEX[this.tone] ?? 1;

    // grade
    const u = this.gradePass.uniforms;
    u.uContrast.value = grade.contrast ?? 0.05;
    u.uSaturation.value = grade.saturation ?? 0;
    u.uTemperature.value = grade.temperature ?? 0;
    u.uTint.value = grade.tint ?? 0;
    u.uVignette.value = grade.vignette ?? 0.25;
    u.uGrain.value = grade.grain ?? 0.02;
    u.uChroma.value = grade.chroma ?? 0;
    u.uLetterbox.value = grade.letterbox ?? 0;
    const hl = grade.highlightTint || [1, 1, 1];
    const sh = grade.shadowTint || [0, 0, 0];
    u.uHighlightTint.value.set(hl[0], hl[1], hl[2]);
    u.uShadowTint.value.set(sh[0], sh[1], sh[2]);

    // bloom
    if (this.bloomPass) {
      this.bloomPass.strength = post.bloomStrength ?? 0.34;
      this.bloomPass.radius = post.bloomRadius ?? 0.55;
      this.bloomPass.threshold = post.bloomThreshold ?? 0.85;
    }

    // dof
    if (this.bokehPass) {
      const dof = post.dof || {};
      const focus = settings?.dof === true ? settings.dofFocus ?? dof.focus ?? 8 : dof.focus ?? 8;
      const aperture = settings?.dof === true ? settings.dofAperture ?? dof.aperture ?? 0.0022 : dof.aperture ?? 0.0022;
      this.bokehPass.uniforms.focus.value = focus;
      this.bokehPass.uniforms.aperture.value = aperture;
      this.bokehPass.uniforms.maxblur.value = dof.maxblur ?? 0.01;
    }

    this.postState.msaa = msaa;
    this.postState.post = usePost;
    this.postState.bloom = useBloom;
    this.postState.dof = useDof;

    const key = this.chainKey();
    if (key !== this._lastChainKey || !this.composer) {
      this.setupComposer();
    } else if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }

    this.renderer.shadowMap.enabled = settings?.shadows !== false;
    this.grid.visible = !!settings?.showGrid;
    this.gradePass.uniforms.uResolution.value.set(
      this.canvas.clientWidth * this.renderer.getPixelRatio(),
      this.canvas.clientHeight * this.renderer.getPixelRatio()
    );
  }

  renderNow() {
    if (!this.renderer) return;
    this.renderer.info.reset();
    if (this.postState.post && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _loop = () => {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    if (document.hidden) return;

    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    if (this._cameraAnim) this.stepCameraAnim();

    for (const fn of this.frameHooks) {
      try { fn(dt, t); } catch (e) { console.error('[frame]', e); }
    }

    this.controls.update();
    this.updateGridCenter();
    this.gradePass.uniforms.uTime.value = t;
    this.renderNow();

    // stats
    this._frames++;
    const now = performance.now();
    if (now - this._fpsTime > 420) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsTime));
      this._frames = 0;
      this._fpsTime = now;
      const info = this.renderer.info.render;
      emit('engine:stats', {
        fps: this.fps,
        triangles: info.triangles,
        calls: info.calls,
        scale: this._dynScale,
        objects: this.scene.children.length,
      });
      this.adaptResolution();
    }
  };

  adaptResolution() {
    const settings = this.settings;
    if (!settings || !settings.dynamicResolution) {
      if (this._dynScale !== 1) {
        this._dynScale = 1;
        this.resize();
      }
      return;
    }
    if (settings.quality !== 'auto' && settings.quality !== 'high') return;
    const fps = this.fps;
    let changed = false;
    if (fps < 44 && this._dynScale > 0.62) {
      this._dynScale = Math.max(0.62, this._dynScale - 0.08);
      changed = true;
    } else if (fps > 57 && this._dynScale < 1) {
      this._dynScale = Math.min(1, this._dynScale + 0.04);
      changed = true;
    }
    if (changed && performance.now() - this._lastQualityCheck > 1200) {
      this._lastQualityCheck = performance.now();
      this.resize();
    }
  }

  updateGridCenter() {
    if (!this.gridMat) return;
    const c = this.controls.target;
    this.gridMat.uniforms.uCenter.value.set(c.x, 0, c.z);
    this.grid.position.x = Math.round(c.x / 10) * 10;
    this.grid.position.z = Math.round(c.z / 10) * 10;
    this.gridMat.uniforms.uOpacity.value = app.settings?.showGrid ? 0.14 : 0;
  }

  updateBrackets() {
    this._updateBracketSet(this.brackets, this._selectedRoot);
    this._updateBracketSet(this.hoverBrackets, this._hoverRoot);
  }

  showHover(root) {
    if (this._hoverRoot === root) return;
    this._hoverRoot = root || null;
    this.updateBrackets();
  }

  hideHover() {
    this.showHover(null);
  }

  _updateBracketSet(brackets, obj) {
    if (!obj || !obj.visible) {
      brackets.visible = false;
      return;
    }
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) {
      brackets.visible = false;
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const len = Math.min(0.45, Math.max(0.02, Math.min(size.x, size.y, size.z) * 0.22));
    const pos = brackets.geometry.attributes.position;
    const arr = pos.array;
    let i = 0;
    const corners = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) corners.push([x, y, z]);
      }
    }
    for (const [x, y, z] of corners) {
      for (const axis of [0, 1, 2]) {
        const end = [x, y, z];
        const dir = end[axis] === box.max.getComponent(axis) ? -1 : 1;
        end[axis] += dir * len;
        arr[i++] = x; arr[i++] = y; arr[i++] = z;
        arr[i++] = end[0]; arr[i++] = end[1]; arr[i++] = end[2];
      }
    }
    pos.needsUpdate = true;
    brackets.geometry.computeBoundingSphere();
    brackets.visible = true;
  }

  attachGizmo(root) {
    this._selectedRoot = root || null;
    if (root) {
      this.gizmo.attach(root);
      this.gizmo.enabled = true;
      this.updateBrackets();
    } else {
      this.gizmo.detach();
      this.gizmo.enabled = false;
      this.brackets.visible = false;
    }
  }

  setHelperVisibility(visible) {
    this.helpers.visible = visible;
  }

  frameObject(obj, { animate = true, offset = 1.9 } = {}) {
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.15, sphere.radius);
    const fov = rad(this.camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * offset;
    const dir = new THREE.Vector3(0.72, 0.52, 0.9).normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist));
    this.moveCamera(pos, center, animate ? 620 : 0);
  }

  frameAll(objects) {
    const box = new THREE.Box3();
    for (const o of objects) {
      if (o && o.visible) box.expandByObject(o);
    }
    if (box.isEmpty()) {
      this.moveCamera(new THREE.Vector3(7, 4.4, 9), new THREE.Vector3(0, 0.9, 0), 600);
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (Math.max(0.4, sphere.radius) / Math.sin(rad(this.camera.fov) / 2)) * 1.6;
    const dir = new THREE.Vector3(0.7, 0.5, 0.9).normalize();
    this.moveCamera(center.clone().add(dir.multiplyScalar(dist)), center, 650);
  }

  moveCamera(pos, target, duration = 700) {
    if (!duration) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this._cameraAnim = {
      t: 0,
      duration,
      fromPos: this.camera.position.clone(),
      toPos: pos.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
  }

  stepCameraAnim() {
    const a = this._cameraAnim;
    if (!a) return;
    a.t += 1000 / 60;
    const k = clamp(a.t / a.duration, 0, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
    this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
    this.controls.update();
    if (k >= 1) this._cameraAnim = null;
  }

  cameraPreset(name) {
    const target = this.controls.target.clone();
    const d = this.camera.position.distanceTo(target) || 6;
    const presets = {
      perspective: new THREE.Vector3(0.7, 0.5, 0.9),
      front: new THREE.Vector3(0, 0.16, 1),
      back: new THREE.Vector3(0, 0.16, -1),
      left: new THREE.Vector3(-1, 0.16, 0),
      right: new THREE.Vector3(1, 0.16, 0),
      top: new THREE.Vector3(0.001, 1, 0.001),
      iso: new THREE.Vector3(1, 0.8, 1),
    };
    const v = (presets[name] || presets.perspective).clone().normalize().multiplyScalar(d);
    this.moveCamera(target.clone().add(v), target, 520);
  }

  setSelection(root) {
    this.attachGizmo(root);
  }

  setGizmoMode(mode) {
    this.gizmo.setMode(mode);
  }
  setGizmoSpace(space) {
    this.gizmo.setSpace(space);
  }
  setGizmoSnap(on) {
    this.gizmo.setTranslationSnap(on ? 0.25 : null);
    this.gizmo.setRotationSnap(on ? Math.PI / 12 : null);
    this.gizmo.setScaleSnap(on ? 0.1 : null);
  }

  isBigEnoughForPost() {
    return this.canvas.clientWidth * this.canvas.clientHeight > 140000;
  }

  /**
   * Render at a larger buffer and return the PNG data URL.
   * Caller is responsible for cropping if needed.
   */
  captureDataURL(scale = 1, maxDim = 4096) {
    const el = this.renderer.domElement;
    const cw = Math.max(1, el.clientWidth);
    const ch = Math.max(1, el.clientHeight);
    let s = Math.max(1, scale);
    if (Math.max(cw, ch) * s > maxDim) s = maxDim / Math.max(cw, ch);
    const tw = Math.max(1, Math.round(cw * s));
    const th = Math.max(1, Math.round(ch * s));

    const prevHelpers = this.helpers.visible;
    this.helpers.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(tw, th, false);
    this.camera.aspect = tw / th;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(1);
      this.composer.setSize(tw, th);
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    let url = '';
    try {
      url = el.toDataURL('image/png');
    } catch (e) {
      console.error('capture failed', e);
    }
    this.helpers.visible = prevHelpers;
    this.resize();
    return url;
  }

  thumbnail(object, { size = 320, light = null } = {}) {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
    const root = object.clone(true);
    scene.add(root);
    const env = this.scene.environment;
    if (env) scene.environment = env;
    scene.environmentIntensity = 1.1;

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.1, sphere.radius);
    root.position.sub(center);
    root.updateMatrixWorld(true);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 0.9);
    scene.add(hemi);
    if (light) {
      const l = light.clone();
      l.shadow && (l.shadow.mapSize.set(512, 512), (l.castShadow = false));
      scene.add(l);
    } else {
      const d = new THREE.DirectionalLight(0xffffff, 2.2);
      d.position.set(3, 5, 4);
      scene.add(d);
    }
    const rim = new THREE.DirectionalLight(0x99aaff, 1.0);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const dist = (radius / Math.sin(rad(26) )) * 1.25;
    cam.position.set(center.x + dist * 0.62, center.y + dist * 0.42, center.z + dist * 0.72);
    cam.lookAt(0, 0, 0);

    const el = this.renderer.domElement;
    const prevPR = this.renderer.getPixelRatio();
    const prevSize = this.renderer.getSize(new THREE.Vector2());
    const prevClear = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    const prevTone = this.renderer.toneMapping;
    const prevHelpers = this.helpers.visible;
    const prevAspect = this.camera.aspect;

    this.helpers.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = TONE_MAP[this.tone] || THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);
    this.renderer.render(scene, cam);
    let url = '';
    try {
      url = el.toDataURL('image/png');
    } catch (e) {
      console.warn('thumb failed', e);
    }

    this.renderer.setPixelRatio(prevPR);
    this.renderer.setSize(Math.round(prevSize.x), Math.round(prevSize.y), false);
    this.renderer.setClearColor(prevClear, prevAlpha);
    this.renderer.toneMapping = prevTone;
    this.renderer.toneMappingExposure = this.gradePass.uniforms.uExposure.value;
    this.helpers.visible = prevHelpers;
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    this.resize();

    scene.environment = null;
    scene.clear();
    return url;
  }

  start() {
    if (!this._running) {
      this._running = true;
      this._loop();
    }
  }

  stop() {
    this._running = false;
  }
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        // only dispose textures flagged as generated by us (not shared library textures)
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture && v.userData?.generated) v.dispose?.();
        }
        m.dispose?.();
      }
    }
  });
}
