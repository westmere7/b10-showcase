# B10 Showcase: RMIT Vietnam Experience Day 2026

An interactive 3D floor plan of the B10 sports hall showcase, covering SSET, SCD and TBS.
It's a static site (plain HTML, CSS and JS, with three.js from a CDN), so no build step or server is needed.

## Viewing it locally

Opening `index.html` straight from disk won't work, because browsers block module and model loading over `file://`.
On Windows, double-click **`launch.bat`**. It starts a local server (Python, or Node's `npx` if Python isn't
installed) and opens <http://localhost:8000>; `launch.bat 9000` uses another port. Or serve the folder yourself:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Publishing

Push this folder as a repository and turn on **GitHub Pages** (Settings → Pages → Deploy from branch → `main` / root).
`.nojekyll` is included so Pages serves the files as they are. Any other static host (Netlify, Cloudflare Pages, an
RMIT web server) works the same way: upload the folder.

## Updating the model after the .blend changes

From the `3D` folder, run `_tools\publish.bat` (double-click it, or run it in a terminal). It:

1. runs `_tools/optimize_heavy.py` on the master `EXPday26_3DPlan_Combined.blend` and writes a cleaned copy to
   `_build/EXPday26_web.blend` (the master is never modified);
2. runs `_tools/export_web.py`, which writes `models/*.glb` and `models/manifest.json` here.

SCD's model is rebuilt from the newest file in `SCD/` (a SketchUp `.skp`, or a `.dae` export). `.skp` files are read
with the [OpenSKP](https://extensions.blender.org/add-ons/openskp-import-export/) add-on kept in `_tools/openskp`, so
SketchUp isn't needed; the build turns SCD to whichever quarter turn best fits its zone and sets it on the floor.

The export stores any geometry shared between objects (array modifiers, copied stands) only once. This
is lossless: every mesh keeps its exact shape, normals, UVs and materials.

Then commit and push `models/`. The viewer adds the manifest's version number to each model URL,
so visitors get the new models straight away instead of stale cached ones.

## Files

| Path | What it is |
|---|---|
| `index.html` | Page shell and UI |
| `assets/app.js` | Viewer: loading, camera presets, walk mode, tours, shading and tint |
| `assets/style.css` | RMIT-branded styles |
| `assets/logo.svg` | *Optional.* Drop RMIT's official logo here and it replaces the text wordmark |
| `models/*.glb` | Draco-compressed layers: hall, seating, roof, SSET, SCD, TBS, zone guides |
| `models/manifest.json` | Layer list, zone names and colours, hall bounds, version |

## Controls

- **Orbit:** left-drag rotates; middle- or right-drag (or two fingers) drags the view; the scroll wheel or a pinch moves forward and back along the view direction. The on-screen buttons do the same. Click any stand to fly straight to it (hovering outlines it); click the open floor of a school's coloured zone to fly to that school. Any part of the hall structure (walls, columns) or the grandstands that comes between the camera and the stands fades to a faint outline; walk mode keeps it solid.
- **Mac trackpad:** click-drag rotates, a two-finger swipe drags the view, a pinch moves forward and back, and a two-finger twist rotates (Safari).
- **Walk mode:** 1.7 m eye height. Click the floor to walk there, drag to look, use WASD or the arrow keys to move, the mouse wheel (or + / −) to zoom the field of view, and press Esc to exit.
- **Views:** Overview, Top, one per school, and Entrance (starts walk mode). Outside walk mode, Esc returns to the Overview and Space switches to the top view. School labels start hidden; turn them on under Show / hide.
- **Tours:** full hall orbit, all schools, or one school.
- **Settings:** Material or Solid shading, sun shadows on or off (the sun button, or <kbd>L</kbd>), a per-school tint with colour pickers, and layer toggles for each school, the zone guides, the hall structure, the grandstands and the roof.
