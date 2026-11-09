# tools

Scripts Claude runs in its workspace. Requirements: Node.js 20 or newer (`npm install` once in the repo root), and Python 3 with Pillow for the image tools.

| Tool | What it does |
|---|---|
| `validate.mjs` | Checks a pack's maps and walls, and optionally a save's map state, against the schemas and the design rules. `node tools/validate.mjs <pack-dir or map-dir> [--save <save-dir>]` (also `npm run validate -- ...`). Exit code 1 on errors. |
| `wall_overlay.py` | Draws a map's wall segments for review, colour-coded by type with one-way arrows. `python3 tools/wall_overlay.py <map-dir> [--out file] [--blank]`. `--blank` draws on a plain grid instead of the map image. |

Planned: map importers (PDF, grid calibration, wall detection and vectorizing), the sight engine command-line wrapper, the sheet filler, the board publish script and the `doctor` setup check.
