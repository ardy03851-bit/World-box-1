# Worldbox

A self-contained 3D world studio that runs entirely in the browser — built for iPad first, sized up for desktop. Frosted-glass interface, physically based rendering, an asset library you can drag straight into the scene, and one-tap photography and export.

No build step, no bundler, no accounts. Open `index.html` (or serve the folder) and start building.

## Features

**Scenes**
- Five procedural starter worlds — Noir Canyon, Dune Sea, Glass Garden, Studio Mill, Midnight Atrium — plus a blank studio.
- Objects, terrains, primitives, lights and imported models, each with transform, material and shadow controls.
- Undo/redo across every edit, with selection preserved.
- Automatic save to IndexedDB, plus portable `.wbox` / project JSON files for quick reload elsewhere.

**Assets**
- Import models (`glb`, `gltf`, `fbx`, `obj` + `mtl`, `stl`, `ply`), textures (`png`, `jpg`, `webp`, `bmp`, `avif`) and environments (`hdr`, `exr`).
- Drop whole asset sets as a ZIP — models, textures and `.bin` sidecars are matched automatically.
- Smart auto-texture: incoming albedo, normal, roughness, metalness, AO and displacement maps are detected and wired to the matching channels.
- Drag a model from the dock onto the canvas; it lands on the surface under your finger. Drag a texture onto a model to paint it directly.
- Every asset gets a thumbnail and lives in the library, ready to reuse in any scene.

**Rendering**
- WebGL 2 / three.js r180, PBR materials, image-based lighting, soft shadows, fog, bloom, depth of field and a film grade.
- Quality tiers that scale pixel ratio and effects for iPad GPUs.
- Cinematic grade controls: exposure, contrast, saturation, temperature, tint, vignette, grain, chromatic aberration, bloom and depth of field.

**Photography**
- Dedicated camera mode with focal length, exposure, focus distance, film looks (Clean, Noir, Cinema, Warm, Ice, Analog), aspect ratios and 1×/2×/4× output.
- Gallery of every shot with a full-screen viewer and download.

**Export**
- Scene or selection as GLB, selection as OBJ, scene as PNG, project JSON, or a complete `.wbox` bundle (project + asset blobs).

## Gestures

| Action | Touch | Desktop |
| --- | --- | --- |
| Orbit | One-finger drag | Left-drag |
| Pan | Two-finger drag | Right-drag / two-finger |
| Zoom | Pinch | Scroll / wheel |
| Select | Tap an object | Click |
| Focus object | Double-tap | Double-click |
| Transform | Drag the gizmo arrows | Drag gizmo |
| Deselect | Tap empty space | Click empty space |

Panels are toggled from the left rail; the inspector appears when something is selected.

## Hosting on GitHub Pages

Everything is static and relative-path safe.

1. Merge the branch into `main`.
2. In **Settings → Pages**, set **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/World-box-1/`.

`index.html`, `manifest.webmanifest` and `sw.js` sit at the repository root, so project-page subpaths work without configuration. The optional service worker caches the shell for offline launches; it registers only over `http(s)`.

To run locally, serve the repository root with any static server:

```sh
python3 -m http.server 8123
```

Then visit `http://localhost:8123/`.

## Project layout

```
index.html            app shell, SVG sprite, import map
css/app.css           design system, glass surfaces, responsive iPad layout
js/main.js            boot, viewport gestures, autosave
js/core/              renderer, environment, materials, objects, world, history
js/assets/            IndexedDB storage and the import pipeline
js/ui/                widgets, panels, asset library, photo mode, home screen
vendor/three/         three.js r180 build + addons (GLTF, OBJ, FBX, STL, PLY, HDR, Draco, RoomEnvironment)
vendor/jszip/         ZIP import/export
```

## Browser support

iPadOS Safari 16+, current Safari, Chrome and Edge. WebGL 2 with float render targets is required for the full effect stack; the app falls back to a lighter pipeline when a feature is unavailable.
