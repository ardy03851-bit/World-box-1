import { app, QUALITY } from '../app.js';
import { emit } from '../bus.js';
import { PRESETS, getPreset } from '../presets.js';
import { PRIMITIVES } from '../core/objects.js';
import { MATERIAL_PRESETS } from '../core/materials.js';
import { formatBytes, debounce, clamp } from '../core/util.js';
import {
  el, icon, clear, section, card, row, hint, button, iconButton, toggle, slider,
  segmented, chips, colorField, selectField, toast, confirmDialog, haptic, emptyState,
} from './kit.js';

export const PANEL_META = {
  tools: { kicker: 'TOOLS', title: 'Transform' },
  add: { kicker: 'ADD', title: 'Create' },
  assets: { kicker: 'LIBRARY', title: 'Assets' },
  scene: { kicker: 'SCENE', title: 'Layers' },
  look: { kicker: 'LOOK', title: 'Light & grade' },
  settings: { kicker: 'SETTINGS', title: 'Studio' },
  help: { kicker: 'HELP', title: 'Gestures & keys' },
};

let sceneQuery = '';

export function buildLeftPanel(name, ctx) {
  switch (name) {
    case 'add': return buildAdd(ctx);
    case 'assets': return buildAssets(ctx);
    case 'scene': return buildScene(ctx);
    case 'look': return buildLook(ctx);
    case 'settings': return buildSettings(ctx);
    case 'help': return buildHelp(ctx);
    default: return buildTools(ctx);
  }
}

// ── tools ────────────────────────────────────────────────────
function buildTools(ctx) {
  const rec = app.world?.getSelectedRecord();
  const modeRow = el('div', { class: 'mode-row' },
    ...[
      ['translate', 'move', 'Move', 'W'],
      ['rotate', 'rotate', 'Rotate', 'E'],
      ['scale', 'scale', 'Scale', 'R'],
    ].map(([mode, iconName, label, key]) => {
      const btn = el('button', {
        class: `mode-btn ${app.engine.gizmo.mode === mode ? 'active' : ''}`,
        dataset: { mode },
        type: 'button',
        onclick: () => ctx.setMode(mode),
      }, icon(iconName), el('span', {}, label), el('kbd', { class: 'kbd' }, key));
      return btn;
    })
  );

  const body = el('div', { class: 'stack' },
    modeRow,
    card(
      row('Local space', toggle(app.settings.gizmoSpace === 'local', (v) => ctx.setSpace(v ? 'local' : 'world'))),
      row('Snap steps', toggle(!!app.settings.gizmoSnap, (v) => ctx.setSnap(v))),
    ),
    rec ? el('div', { class: 'stack' },
      el('div', { class: 'sub-label' }, 'SELECTED'),
      card(
        el('div', { class: 'sel-summary' },
          icon(rec.desc.kind === 'light' ? 'light' : rec.desc.kind === 'terrain' ? 'mountain' : 'cube'),
          el('div', {}, el('strong', {}, rec.root.name), el('span', {}, typeLabel(rec.desc.kind)))
        ),
        el('div', { class: 'btn-row' },
          button('Focus', { small: true, iconName: 'focus', onClick: () => ctx.world.frameSelected() }),
          button('Duplicate', { small: true, iconName: 'copy', onClick: () => ctx.world.duplicateSelected() }),
          button('Drop', { small: true, iconName: 'download', onClick: () => { ctx.world.dropSelectedToFloor(); ctx.history?.note('Drop', 80); } })
        )
      )
    ) : card(hint('Tap an object in the scene to select it. The gizmo lets you drag, twist and scale in 3D.')),
    section('Workspace', [
      card(
        row('Grid', toggle(!!app.settings.showGrid, (v) => {
          app.settings.showGrid = v;
          app.engine.grid.visible = v;
          ctx.saveSettings();
        })),
        row('Post processing', toggle(app.settings.post !== false, (v) => {
          app.settings.post = v;
          ctx.applySettings();
          ctx.refresh();
        })),
        row('Shadows', toggle(app.settings.shadows !== false, (v) => {
          app.settings.shadows = v;
          ctx.applySettings();
          ctx.refresh();
        }))
      ),
    ], { collapsed: true }),
    section('Navigation', [
      hint(isTouch() ? 'One finger orbits · two fingers pan & pinch · tap to select · double-tap to frame.' : 'Drag to orbit · right-drag to pan · scroll to zoom · double-click to frame.'),
      hint('Drag an asset from the dock straight into the world. Drop a texture onto a model to paint it.')
    ], { collapsed: false }),
  );
  return body;
}

function isTouch() {
  return navigator.maxTouchPoints > 0;
}

function typeLabel(kind) {
  return { primitive: 'Primitive', terrain: 'Terrain', light: 'Light', asset: 'Imported model', group: 'Group' }[kind] || 'Object';
}

// ── add ──────────────────────────────────────────────────────
function buildAdd(ctx) {
  const primGrid = el('div', { class: 'prim-grid' });
  for (const p of PRIMITIVES) {
    const btn = el('button', { class: 'prim-btn', type: 'button', title: p.label, onclick: () => {
      ctx.world.addPrimitive(p.type);
      haptic(8);
      ctx.refresh();
      ctx.refreshInspector?.();
    } },
      icon(p.icon),
      el('span', {}, p.label)
    );
    primGrid.append(btn);
  }

  const lightRow = el('div', { class: 'btn-row' },
    button('Sun', { iconName: 'sun', small: true, onClick: () => { ctx.world.addLight('directional'); haptic(6); } }),
    button('Point', { iconName: 'light', small: true, onClick: () => { ctx.world.addLight('point'); haptic(6); } }),
    button('Spot', { iconName: 'aperture', small: true, onClick: () => { ctx.world.addLight('spot'); haptic(6); } })
  );

  const uploadCard = el('div', { class: 'mini-upload', onclick: () => ctx.openLibrary() },
    el('div', { class: 'upload-orb small' }, icon('upload')),
    el('div', {}, el('strong', {}, 'Bring your own assets'), el('span', {}, 'GLB · FBX · OBJ · STL · PLY · ZIP · textures · HDRIs')),
    el('span', { class: 'mini-badge' }, 'Library')
  );

  return el('div', { class: 'stack' },
    section('Primitives', primGrid, { collapsed: false }),
    section('Lights', [lightRow, hint('Every light is an object you can reposition and edit.')], { collapsed: false }),
    section('World building', [
      el('div', { class: 'btn-row' },
        button('Terrain', { iconName: 'mountain', onClick: () => { ctx.world.addTerrain(); ctx.refresh(); } }),
        button('Rock field', { iconName: 'sparkles', onClick: () => {
          ctx.world.addPrimitive('icosahedron', { material: 'clay' });
          const rec = ctx.world.getSelectedRecord();
          if (rec) {
            rec.root.scale.setScalar(0.55);
            ctx.world.syncTransform(rec.id);
            ctx.world.scatterSelected({ count: 16, radius: 11, scaleJitter: 0.9 });
          }
          ctx.refresh();
        } })
      ),
      el('div', { class: 'btn-row' },
        button('Neon ring', { iconName: 'torus', onClick: () => {
          ctx.world.addPrimitive('torus', { material: 'neon' });
          const rec = ctx.world.getSelectedRecord();
          if (rec) {
            rec.root.material.emissive.set('#6df0ff');
            rec.root.material.emissiveIntensity = 5;
            rec.root.rotation.x = Math.PI / 2;
            ctx.world.syncTransform(rec.id);
          }
          ctx.refresh();
        } }),
        button('Glass orb', { iconName: 'sphere', onClick: () => { ctx.world.addPrimitive('sphere', { material: 'glass' }); ctx.refresh(); } })
      ),
      hint('Combine primitives with imported models, then grade the whole world in <b>Look</b>.')
    ], { collapsed: false }),
    section('Import', uploadCard, { collapsed: false }),
  );
}

// ── assets panel ─────────────────────────────────────────────
function buildAssets(ctx) {
  const assets = app.library?.list('all') || [];
  const recent = assets.slice(0, 8);
  const rows = recent.map((a) => el('button', { class: 'asset-mini', type: 'button', onclick: () => ctx.useAsset ? ctx.useAsset(a.id) : ctx.openLibrary() },
    a.thumb ? el('img', { src: a.thumb, alt: '' }) : el('div', { class: 'asset-mini-glyph' }, icon(a.kind === 'env' ? 'globe' : a.kind === 'texture' ? 'image' : 'cube')),
    el('div', { class: 'asset-mini-txt' },
      el('strong', {}, a.name),
      el('span', {}, a.kind === 'model' ? `${(a.meta?.triangles || 0).toLocaleString()} tris` : a.kind === 'texture' ? `${a.meta?.width || '?'}×${a.meta?.height || '?'}` : 'HDRI environment')
    ),
    icon('plus')
  ));

  return el('div', { class: 'stack' },
    el('div', { class: 'btn-row' },
      button('Import files', { iconName: 'upload', variant: 'primary', onClick: () => ctx.openLibrary() }),
      button('Library', { iconName: 'folder', onClick: () => ctx.openLibrary() })
    ),
    card(
      el('div', { class: 'row' },
        el('span', { class: 'label' }, 'Smart textures'),
        toggle(!!app.settings.smartTextures, (v) => {
          app.settings.smartTextures = v;
          ctx.applySettings();
          ctx.refresh();
          toast(v ? 'Smart matching on — uploaded textures find their maps' : 'Smart matching off', 'success');
        })
      ),
      hint('When a model arrives with texture sets, channels are read from their names (<b>normal</b>, <b>roughness</b>, <b>albedo</b>, <b>ORM</b>…) and wired to the right slots automatically.')
    ),
    section('Recent', recent.length ? rows : hint('No assets yet. Import a model or drop a ZIP anywhere in the app.'), { collapsed: false }),
    section('Tips', [
      hint('Drag from the dock into the scene to place a model. Drag a texture onto a model to apply it.'),
      hint('Use <b>ZIP</b> for whole asset folders — models, textures and HDRIs are unpacked together.'),
    ], { collapsed: true }),
    app.library?.assets.size ? card(
      row('Assets', el('span', { class: 'mini' }, String(app.library.assets.size))),
      row('Models', el('span', { class: 'mini' }, String(app.library.list('model').length))),
      row('Textures', el('span', { class: 'mini' }, String(app.library.list('texture').length)))
    ) : null
  );
}

// ── scene ────────────────────────────────────────────────────
function buildScene(ctx) {
  const search = el('input', { class: 'text-input', type: 'search', placeholder: 'Search layers', value: sceneQuery });
  const listWrap = el('div', { class: 'outliner' });

  const renderList = () => {
    clear(listWrap);
    const q = sceneQuery.toLowerCase();
    const recs = [...app.world.records.values()].filter((r) => !q || r.root.name.toLowerCase().includes(q));
    if (!recs.length) {
      listWrap.append(el('div', { class: 'empty-note' }, q ? 'No layers match.' : 'Your scene is empty — add a primitive or import a model.'));
      return;
    }
    for (const rec of recs) {
      const kindIcon = rec.desc.kind === 'light' ? 'light' : rec.desc.kind === 'terrain' ? 'mountain' : rec.desc.kind === 'asset' ? 'cube' : 'sphere';
      const item = el('div', {
        class: `out-item${app.selection === rec.id ? ' selected' : ''}${rec.root.visible ? '' : ' hidden-obj'}`,
        dataset: { id: rec.id },
      },
        icon(kindIcon),
        el('span', { class: 'name' }, rec.root.name),
        el('div', { class: 'row-actions' },
          el('button', { title: rec.root.visible ? 'Hide' : 'Show', type: 'button', onclick: (e) => {
            e.stopPropagation();
            ctx.world.setVisibility(rec.id, !rec.root.visible);
            renderList();
          } }, icon(rec.root.visible ? 'eye' : 'eye-off')),
          el('button', { title: rec.desc.locked ? 'Unlock' : 'Lock', type: 'button', onclick: (e) => {
            e.stopPropagation();
            ctx.world.setLocked(rec.id, !rec.desc.locked);
            renderList();
          } }, icon(rec.desc.locked ? 'lock' : 'unlock'))
        )
      );
      item.addEventListener('click', () => { ctx.selectObject(rec.id); renderList(); });
      item.addEventListener('dblclick', () => { ctx.selectObject(rec.id); ctx.world.frameSelected(); });
      listWrap.append(item);
    }
  };
  renderList();

  search.addEventListener('input', () => {
    sceneQuery = search.value.trim();
    renderList();
  });

  const total = app.world.records.size;
  return el('div', { class: 'stack' },
    el('div', { class: 'btn-row' },
      button('Frame all', { iconName: 'focus', onClick: () => ctx.frameAll() }),
      button('Deselect', { iconName: 'close', onClick: () => ctx.world.select(null) })
    ),
    search,
    el('div', { class: 'scene-stats' },
      el('span', { dataset: { sceneCount: '' } }, `${total} layer${total === 1 ? '' : 's'}`),
      el('span', {}, `${(app.library?.list('model').length || 0)} models in library`)
    ),
    listWrap,
    hint('Tip · <b>Tab</b> cycles layers, <b>F</b> frames the selection, <b>⌘D</b> duplicates.')
  );
}

// ── look ─────────────────────────────────────────────────────
function buildLook(ctx) {
  const env = app.project?.environment;
  if (!env) return hint('No environment yet.');

  const envEdit = (fn, { immediate = false } = {}) => {
    fn(env);
    app.world.applyEnvironment(env, { immediate });
    app.engine.applyLook(env, app.settings);
    emit('project:changed', { source: 'environment' });
    app.history?.note('Environment', 600);
  };
  const envEditDebounced = debounce((fn) => {
    fn(env);
    app.world.applyEnvironment(env, { immediate: false });
    app.engine.applyLook(env, app.settings);
    emit('project:changed', { source: 'environment' });
    app.history?.note('Environment', 900);
  }, 90);

  const swatches = el('div', { class: 'swatch-grid' });
  for (const p of PRESETS) {
    const sw = el('button', {
      type: 'button',
      class: `swatch${env.name === p.name ? ' active' : ''}`,
      title: p.name,
      onclick: () => {
        const next = structuredClone(p.env);
        next.name = p.name;
        app.world.applyEnvironment(next, { immediate: true });
        app.project.environment = next;
        app.engine.applyLook(next, app.settings);
        emit('project:changed', { source: 'environment' });
        app.history?.note('Look', 100);
        ctx.refresh();
        toast(`${p.name} look applied`, 'success');
      },
    },
      el('i', { style: { '--g': gradientFor(p.palette) } }),
      el('span', {}, p.name)
    );
    swatches.append(sw);
  }

  const sky = env.sky || (env.sky = {});
  const sun = env.sun || (env.sun = {});
  const ground = env.ground || (env.ground = {});
  const fog = env.fog || (env.fog = {});
  const grade = env.grade || (env.grade = {});
  const post = env.post || (env.post = {});

  const skyType = env.background?.type || 'color';

  return el('div', { class: 'stack' },
    section('Looks', [
      swatches,
      hint('Looks change the sky, sun, fog and grade — your objects stay put.')
    ], { collapsed: false }),

    section('Sky & sun', [
      segmented({
        options: [{ value: 'sky', label: 'Sky' }, { value: 'gradient', label: 'Gradient' }, { value: 'color', label: 'Solid' }],
        value: skyType,
        full: true,
        onChange: (v) => {
          env.background = env.background || { type: 'color', color: '#101014' };
          env.background.type = v;
          if (v === 'gradient' && !env.background.top) {
            env.background.top = '#cfd8e6';
            env.background.bottom = '#6b7482';
          }
          envEdit(() => {}, { immediate: true });
          ctx.refresh();
        },
      }),
      skyType === 'color' ? row('Background', colorField({ value: env.background.color || '#0b0b0f', onChange: (v) => envEdit((e) => { e.background.color = v; }, { immediate: true }) })) : null,
      skyType === 'gradient' ? el('div', { class: 'stack' },
        row('Top', colorField({ value: env.background.top || '#dfe6ee', onChange: (v) => envEdit((e) => { e.background.top = v; }, { immediate: true }) })),
        row('Horizon', colorField({ value: env.background.bottom || '#8d949e', onChange: (v) => envEdit((e) => { e.background.bottom = v; }, { immediate: true }) })),
      ) : null,
      skyType === 'hdri' ? hint('Using an HDR environment. Pick another environment in the library to change the mood.') : null,
      slider({ label: 'Sun height', min: -4, max: 88, step: 0.5, value: sky.sunElevation ?? 16, precision: 1, unit: '°', onInput: (v) => envEditDebounced((e) => { e.sky.sunElevation = v; }) }),
      slider({ label: 'Sun direction', min: 0, max: 360, step: 1, value: sky.sunAzimuth ?? 190, precision: 0, unit: '°', onInput: (v) => envEditDebounced((e) => { e.sky.sunAzimuth = v; }) }),
      row('Sun color', colorField({ value: sun.color || '#fff2e0', onChange: (v) => envEdit((e) => { e.sun.color = v; }, { immediate: true }) })),
      slider({ label: 'Sun power', min: 0, max: 8, step: 0.05, value: sun.intensity ?? 3, onInput: (v) => envEditDebounced((e) => { e.sun.intensity = v; }) }),
      slider({ label: 'Haze', min: 1, max: 12, step: 0.1, value: sky.turbidity ?? 3.4, precision: 1, onInput: (v) => envEditDebounced((e) => { e.sky.turbidity = v; }) }),
      slider({ label: 'Sky scatter', min: 0, max: 3, step: 0.02, value: sky.rayleigh ?? 1.1, onInput: (v) => envEditDebounced((e) => { e.sky.rayleigh = v; }) }),
      row('Soft shadows', toggle(sun.shadows !== false && app.settings.shadows !== false, (v) => {
        env.sun.shadows = v;
        app.settings.shadows = v;
        ctx.applySettings();
        ctx.refresh();
      })),
    ], { collapsed: false }),

    section('Ground & fog', [
      row('Ground plane', toggle(ground.enabled !== false, (v) => envEdit((e) => { e.ground.enabled = v; }, { immediate: true }))),
      row('Ground color', colorField({ value: ground.color || '#17171b', onChange: (v) => envEdit((e) => { e.ground.color = v; }, { immediate: true }) })),
      slider({ label: 'Roughness', min: 0, max: 1, step: 0.01, value: ground.roughness ?? 0.9, onInput: (v) => envEditDebounced((e) => { e.ground.roughness = v; }) }),
      slider({ label: 'Metalness', min: 0, max: 1, step: 0.01, value: ground.metalness ?? 0, onInput: (v) => envEditDebounced((e) => { e.ground.metalness = v; }) }),
      slider({ label: 'Ground size', min: 20, max: 600, step: 5, value: ground.size ?? 280, precision: 0, onInput: (v) => envEditDebounced((e) => { e.ground.size = v; }) }),
      row('Fog', toggle(fog.enabled !== false, (v) => envEdit((e) => { e.fog.enabled = v; }, { immediate: true }))),
      row('Fog color', colorField({ value: fog.color || '#aab0b8', onChange: (v) => envEdit((e) => { e.fog.color = v; }, { immediate: true }) })),
      slider({ label: 'Fog density', min: 0, max: 0.06, step: 0.0005, value: fog.density ?? 0.008, precision: 4, onInput: (v) => envEditDebounced((e) => { e.fog.density = v; }) }),
      row('Ambient bounce', colorField({ value: env.hemi?.sky || '#ccd7ff', onChange: (v) => envEdit((e) => { e.hemi.sky = v; }, { immediate: true }) })),
      slider({ label: 'Ambient power', min: 0, max: 3, step: 0.01, value: env.hemi?.intensity ?? 0.5, onInput: (v) => envEditDebounced((e) => { e.hemi.intensity = v; }) }),
    ], { collapsed: true }),

    section('Grade', [
      row('Exposure', slider({ label: 'Exposure', min: 0.2, max: 2.5, step: 0.01, value: env.exposure ?? 1.05, onInput: (v) => {
        env.exposure = v;
        app.engine.applyLook(env, app.settings);
        emit('project:changed', { source: 'exposure' });
        app.history?.note('Exposure', 500);
      } })),
      row('Tone mapping', selectField({
        options: [
          { value: 'aces', label: 'ACES Filmic' },
          { value: 'agx', label: 'AgX' },
          { value: 'neutral', label: 'Khronos Neutral' },
          { value: 'reinhard', label: 'Reinhard' },
          { value: 'cineon', label: 'Cineon' },
          { value: 'linear', label: 'Linear' },
        ],
        value: env.tone || 'aces',
        onChange: (v) => {
          env.tone = v;
          app.engine.applyLook(env, app.settings);
          emit('project:changed', { source: 'tone' });
          app.history?.note('Tone mapping', 200);
        },
      })),
      slider({ label: 'Contrast', min: -0.7, max: 0.9, step: 0.01, value: grade.contrast ?? 0.05, onInput: (v) => {
        grade.contrast = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Saturation', min: -1, max: 0.8, step: 0.01, value: grade.saturation ?? 0, onInput: (v) => {
        grade.saturation = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Temperature', min: -1, max: 1, step: 0.01, value: grade.temperature ?? 0, onInput: (v) => {
        grade.temperature = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Tint', min: -1, max: 1, step: 0.01, value: grade.tint ?? 0, onInput: (v) => {
        grade.tint = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Vignette', min: 0, max: 1, step: 0.01, value: grade.vignette ?? 0.3, onInput: (v) => {
        grade.vignette = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Grain', min: 0, max: 0.2, step: 0.001, value: grade.grain ?? 0.02, precision: 3, onInput: (v) => {
        grade.grain = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Chromatic', min: 0, max: 0.6, step: 0.005, value: grade.chroma ?? 0, precision: 3, onInput: (v) => {
        grade.chroma = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
      slider({ label: 'Cinema bars', min: 0, max: 0.18, step: 0.005, value: grade.letterbox ?? 0, precision: 3, onInput: (v) => {
        grade.letterbox = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'grade' }); app.history?.note('Grade', 600);
      } }),
    ], { collapsed: true }),

    section('Glow & focus', [
      row('Bloom', toggle(app.settings.bloom !== false, (v) => {
        app.settings.bloom = v; ctx.applySettings(); ctx.refresh();
      })),
      slider({ label: 'Bloom strength', min: 0, max: 2, step: 0.01, value: post.bloomStrength ?? 0.3, onInput: (v) => {
        post.bloomStrength = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'bloom' }); app.history?.note('Bloom', 500);
      } }),
      slider({ label: 'Bloom radius', min: 0, max: 1, step: 0.01, value: post.bloomRadius ?? 0.55, onInput: (v) => {
        post.bloomRadius = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'bloom' }); app.history?.note('Bloom', 500);
      } }),
      slider({ label: 'Bloom threshold', min: 0.2, max: 1.4, step: 0.01, value: post.bloomThreshold ?? 0.88, onInput: (v) => {
        post.bloomThreshold = v; app.engine.applyLook(env, app.settings); emit('project:changed', { source: 'bloom' }); app.history?.note('Bloom', 500);
      } }),
      row('Depth of field', toggle(!!app.settings.dof, (v) => {
        app.settings.dof = v; ctx.applySettings(); ctx.refresh();
      })),
      app.settings.dof ? slider({ label: 'Focus distance', min: 0.3, max: 80, step: 0.1, value: app.settings.dofFocus ?? 8, precision: 1, unit: 'm', onInput: (v) => {
        app.settings.dofFocus = v; app.engine.applyLook(env, app.settings); ctx.saveSettings();
      } }) : null,
      row('HDR environment', button('Browse', { small: true, iconName: 'globe', onClick: () => ctx.openLibrary() })),
    ], { collapsed: true }),

    section('More light', [
      el('div', { class: 'btn-row' },
        button('Point', { small: true, iconName: 'light', onClick: () => { ctx.world.addLight('point'); ctx.refresh(); } }),
        button('Spot', { small: true, iconName: 'aperture', onClick: () => { ctx.world.addLight('spot'); ctx.refresh(); } }),
        button('Sun', { small: true, iconName: 'sun', onClick: () => { ctx.world.addLight('directional'); ctx.refresh(); } })
      ),
      hint('Add practical lights and edit them from the inspector. Bloom picks up anything emissive.')
    ], { collapsed: true }),
  );
}

function gradientFor(palette = []) {
  const p = palette.length ? palette : ['#ffffff', '#888888', '#333333', '#111111'];
  return `radial-gradient(80% 70% at 30% 20%, ${p[0]}, transparent 70%), linear-gradient(155deg, ${p[1]} 0%, ${p[2]} 55%, ${p[3]} 100%)`;
}

// ── settings ─────────────────────────────────────────────────
function buildSettings(ctx) {
  const s = app.settings;
  const qualitySeg = segmented({
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'ultra', label: 'Ultra' },
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Balanced' },
      { value: 'low', label: 'Fast' },
    ],
    value: s.quality,
    full: true,
    small: true,
    onChange: async (v) => {
      s.quality = v;
      ctx.applySettings();
      app.engine._dynScale = 1;
      app.engine.resize();
      app.world.refreshEnvironment(true);
      ctx.refresh();
      toast(`Quality: ${QUALITY[v]?.label || v}`, 'success');
    },
  });

  const smartAggro = selectField({
    options: [
      { value: 'conservative', label: 'Conservative' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'eager', label: 'Eager' },
    ],
    value: s.smartAggression,
    onChange: (v) => { s.smartAggression = v; ctx.saveSettings(); },
  });

  const dataCard = card(
    row('Auto-save', toggle(!!s.autoSave, (v) => { s.autoSave = v; ctx.saveSettings(); })),
    el('div', { class: 'btn-row' },
      button('Save now', { small: true, iconName: 'save', onClick: () => { ctx.world && saveNow(ctx); } }),
      button('Open project', { small: true, iconName: 'folder', onClick: () => document.getElementById('projectInput')?.click() })
    ),
    el('div', { id: 'storageInfo', class: 'hint' }, 'Checking storage…'),
    el('div', { class: 'btn-row' },
      button('Clear cache', { small: true, iconName: 'trash', onClick: async () => {
        if (await confirmDialog('Delete every stored asset, photo and project on this device? This cannot be undone.', 'Clear all')) {
          try { await (await import('../assets/storage.js')).storage.clearAll(); } catch { /* ignore */ }
          toast('Local data cleared — reloading', 'success');
          setTimeout(() => location.reload(), 700);
        }
      } })
    )
  );
  setTimeout(async () => {
    const node = document.getElementById('storageInfo');
    if (!node) return;
    try {
      const { storage } = await import('../assets/storage.js');
      const est = await storage.estimate();
      node.innerHTML = est
        ? `${formatBytes(est.usage || 0)} of ${formatBytes(est.quota || 0)} used · ${app.library?.assets.size || 0} assets cached.`
        : `${app.library?.assets.size || 0} assets cached locally.`;
    } catch {
      node.textContent = 'Local storage is available.';
    }
  }, 0);

  return el('div', { class: 'stack' },
    section('Performance', [
      card(
        el('div', { class: 'sub-label' }, 'QUALITY'),
        qualitySeg,
        row('Dynamic resolution', toggle(!!s.dynamicResolution, (v) => { s.dynamicResolution = v; ctx.applySettings(); ctx.refresh(); })),
        row('Shadows', toggle(s.shadows !== false, (v) => { s.shadows = v; ctx.applySettings(); ctx.refresh(); })),
        row('Post processing', toggle(s.post !== false, (v) => { s.post = v; ctx.applySettings(); ctx.refresh(); })),
        row('Bloom', toggle(s.bloom !== false, (v) => { s.bloom = v; ctx.applySettings(); ctx.refresh(); })),
        row('FPS counter', toggle(!!s.showPerf, (v) => { s.showPerf = v; document.getElementById('perfPill')?.classList.toggle('hidden', !v); ctx.saveSettings(); }))
      ),
      hint('Worldbox scales render resolution automatically to hold a smooth frame rate on iPad, then restores full sharpness when the GPU has headroom.')
    ], { collapsed: false }),

    section('Smart import', [
      card(
        row('Auto-match textures', toggle(!!s.smartTextures, (v) => {
          s.smartTextures = v;
          ctx.applySettings();
          ctx.refresh();
        })),
        row('Confidence', smartAggro),
        el('div', { class: 'btn-row' },
          button('Match selected', { small: true, iconName: 'sparkles', onClick: async () => {
            const rec = app.world.getSelectedRecord();
            if (!rec) { toast('Select a model first', 'warn'); return; }
            const n = await app.library.rematchObject(rec.root, rec.root.name);
            if (n) { ctx.refreshInspector(); app.history?.note('Smart textures', 100); }
          } }),
          button('Match all', { small: true, iconName: 'wand', onClick: async () => {
            let count = 0;
            for (const rec of [...app.world.records.values()]) {
              if (rec.desc.kind !== 'asset') continue;
              count += await app.library.rematchObject(rec.root, rec.root.name);
            }
            toast(count ? `${count} textures matched` : 'No confident matches', count ? 'success' : 'warn');
            ctx.history?.note('Smart textures', 100);
          } })
        ),
        hint('Named maps are detected from file names and colour analysis. Combined <b>ORM</b> maps fill AO, roughness and metalness at once.')
      )
    ], { collapsed: false }),

    section('Importing', [
      card(
        row('Auto-scale models', toggle(!!s.autoScale, (v) => { s.autoScale = v; ctx.saveSettings(); })),
        row('Play animations', toggle(!!s.autoPlayAnimations, (v) => { s.autoPlayAnimations = v; ctx.saveSettings(); })),
        row('Haptics', toggle(!!s.haptics, (v) => { s.haptics = v; ctx.saveSettings(); }))
      ),
      hint('Drop GLB, GLTF, FBX, OBJ, STL, PLY, ZIP folders, images, HDR or EXR files anywhere.')
    ], { collapsed: true }),

    section('Data', [
      dataCard,
      hint('Projects and assets are stored in this browser. Export a <b>.wbox</b> file to carry a world to another device.')
    ], { collapsed: false }),

    section('About', [
      card(
        row('Version', el('span', { class: 'mini' }, '1.0 · glass studio')),
        row('Renderer', el('span', { class: 'mini' }, 'WebGL 2 · three.js')),
        row('Assets', el('span', { class: 'mini' }, String(app.library?.assets.size || 0))),
        row('Objects', el('span', { class: 'mini' }, String(app.world?.records.size || 0)))
      ),
      el('div', { class: 'btn-row' },
        button('Reset settings', { small: true, iconName: 'refresh', onClick: () => {
          if (window.confirm('Reset studio settings to defaults?')) {
            try { localStorage.removeItem('worldbox:settings'); } catch { /* ignore */ }
            location.reload();
          }
        } })
      ),
      hint('Worldbox is a self-contained studio — no accounts, no cloud, no waiting. Built for the joy of making worlds.')
    ], { collapsed: true })
  );
}

async function saveNow(ctx) {
  const { saveProjectNow } = await import('../io.js');
  saveProjectNow();
}

// ── help ─────────────────────────────────────────────────────
function buildHelp(ctx) {
  const gesture = (iconName, title, text) => el('div', { class: 'help-row' },
    el('div', { class: 'help-ic' }, icon(iconName)),
    el('div', {}, el('strong', {}, title), el('span', {}, text))
  );
  const kbd = (keys, text) => el('div', { class: 'key-row' }, el('kbd', { class: 'kbd' }, keys), el('span', {}, text));
  return el('div', { class: 'stack' },
    section('Touch & trackpad', [
      gesture('rotate', 'One finger', 'Orbit around the scene'),
      gesture('move', 'Two fingers', 'Pan across the world'),
      gesture('focus', 'Pinch', 'Zoom in and out'),
      gesture('cursor', 'Tap', 'Select an object or light'),
      gesture('focus', 'Double-tap', 'Frame the object'),
      gesture('camera', 'Drag dock → world', 'Place an asset exactly where you drop it'),
      gesture('image', 'Texture → model', 'Apply a texture with channel detection'),
    ], { collapsed: false }),
    section('Keyboard', [
      kbd('W E R', 'Move · rotate · scale'),
      kbd('F', 'Frame selection'),
      kbd('Tab', 'Cycle objects'),
      kbd('⌘D', 'Duplicate'),
      kbd('⌘Z / ⇧⌘Z', 'Undo · redo'),
      kbd('⌘S', 'Save project'),
      kbd('P', 'Shoot mode'),
      kbd('[ ]', 'Drop to floor · centre'),
      kbd('G', 'Toggle grid'),
      kbd('Esc', 'Deselect / close'),
    ], { collapsed: true }),
    section('Making it sing', [
      hint('Start with a <b>Look</b> — sky, sun and fog set the emotion before any object arrives.'),
      hint('Glass, chrome and gold need something to reflect. Add an HDR environment or a gradient sky, then lower the roughness.'),
      hint('Light with restraint: one key sun, one fill, one practical. Bloom only on what should glow.'),
      hint('Use <b>Shoot</b> for cinematic frames. Film chips change the whole grade, not just the UI.'),
    ], { collapsed: true }),
    section('Getting assets in', [
      hint('A ZIP of a model folder is the best way to carry textures. Worldbox unpacks it, matches maps and builds a thumbnail.'),
      hint('Normal maps, roughness, metalness, AO, albedo, emissive and alpha are recognised by their filenames.'),
      hint('Everything stays on this device — export a <b>.wbox</b> to move a world elsewhere.')
    ], { collapsed: true }),
  );
}
