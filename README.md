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
- **Walk mode** (<kbd>F</kbd>)**:** 1.7 m eye height. Click the floor to walk there, drag to look, use WASD or the arrow keys to move, the mouse wheel (or + / −) to zoom the field of view, <kbd>E</kbd> / <kbd>Q</kbd> to fly up and down (eye level to 12 m), and press Esc to exit.
- **Top view** is a mode of its own: the camera looks straight down (north up) and only pans (drag) and zooms (wheel, pinch, + / −); clicking a stand or zone, or pressing 1 / 2 / 3, frames it from above. Isometric (default) shows a flat, true-to-scale plan; Perspective uses the normal lens; switch with the buttons at the bottom right or Space. Any other view leaves the mode.
- **Views:** Overview, Top, one per school, and Entrance (starts walk mode). Keys 1, 2 and 3 fly to SSET, SCD and TBS; outside walk mode, Esc returns to the Overview and Space switches to the top view. School labels start hidden; turn them on in the Display menu. The Display menu also has a Zone colour slider for how strongly the school areas are tinted on the floor.
- **Photos:** press <kbd>C</kbd> (or the camera button) in any view, walk mode included, to save the current view as a PNG or JPG at 1–8× the on-screen size (8× is limited to what the browser can hold, about 120 megapixels). It is always rendered at the highest quality (anti-aliased and 2× supersampled); labels and toolbars are left out.
- **Videos:** press <kbd>V</kbd> (or the Video tab of the camera button) to record a camera path in walk mode. The view is framed to the video's shape (16:9, 9:16 or 1:1); move to each view and press <kbd>K</kbd> to keyframe it (Backspace undoes). <kbd>Q</kbd> / <kbd>E</kbd> fly down and up, from eye level to 12 m, just below the roof trusses; the roof always stays on. <kbd>Enter</kbd> plays the path back smoothly (a Save path button keeps it as a `.json` file to open again later): positions, points of interest and zoom follow smooth curves through the keyframes; the pace follows how much the camera moves, turns and zooms, blurred over time so it always speeds up and slows down gradually (no jolts at keyframes or sharp turns), easing in and out at the ends. Pick the size (720p, 1080p, 4K) and frame rate (30 or 60), set the camera speed with the slider (0.25x to 3x; the preview follows as you drag), then <kbd>Enter</kbd> renders an MP4 (H.264 through the browser's WebCodecs encoder and mp4-muxer; 2× supersampled up to 1080p). The software encoder is used first, because some graphics cards' hardware encoders drop frames when fed faster than real time; every frame is checked as it comes out, and if any is missing the next encoder is tried. A saved path can be opened again from the Video tab.
- **Watermark:** photos and videos carry the B10 lockup (`assets/b10-lockup.svg`) at the top right, on by default with a switch in both panels. It is sized from the 16:9 reference (22.5% of the frame width there, i.e. 30% of the square root of the frame area, at most 45% of the width) so it keeps the same weight in any shape; video mode shows where it will sit.
- **Tours:** full hall orbit, all schools, or one school.
- **Settings:** Material or Solid shading, sun shadows on or off (the sun button, or <kbd>L</kbd>), and one Display menu with a per-school tint (colour pickers) and layer toggles for each school, the zone guides, the hall structure, the grandstands and the roof.
