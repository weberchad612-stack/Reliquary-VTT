# tools

Scripts Claude runs in its workspace. Requirements: Node.js 20 or newer (`npm install` once in the repo root), and Python 3 with Pillow for the image tools.

| Tool | What it does |
|---|---|
| `validate.mjs` | Checks a pack's maps and walls, and optionally a save's map state, against the schemas and the design rules. `node tools/validate.mjs <pack-dir or map-dir> [--save <save-dir>]` (also `npm run validate -- ...`). Exit code 1 on errors. |
| `sight.mjs` | Asks the sight engine what is visible. `node tools/sight.mjs <map-dir> --from X,Y [--to X,Y] [--state FILE] [--range FEET]`. Points are in cells (3.5,4.5 is the centre of cell 3,4). Prints the visibility polygon, or `{"visible": true/false}` with `--to`. `--token X,Y,SIZE` gives what a whole token sees (one polygon per viewpoint). |
| `move.mjs` | Asks the movement engine. `node tools/move.mjs <map-dir> --token X,Y[,SIZE] (--to X,Y \| --step DX,DY \| --reach FEET) [--state FILE] [--diagonal 1,2] [--squeeze SIZE]`. Prints the cheapest path and its cost, whether one step is allowed, or every reachable position. |
| `wall_overlay.py` | Draws a map's wall segments for review, colour-coded by type with one-way arrows. `python3 tools/wall_overlay.py <map-dir> [--out file] [--blank] [--sight X,Y ...] [--state FILE]`. `--blank` draws on a plain grid instead of the map image; `--sight` shades what is visible from each point and `--token X,Y,SIZE` what a token sees, both through `sight.mjs`. `--path X,Y,SIZE:GX,GY` draws a route and `--reach X,Y,SIZE:FEET` shades reachable positions, through `move.mjs`. |

Planned: map importers (PDF, grid calibration, wall detection and vectorizing), explored-area merging, the sheet filler, the board publish script and the `doctor` setup check.
