# Future: making sight and the fog renderer faster

Status: idea, not scheduled. Pick it up with the light phase (design doc section 15, step 6), or sooner if a target below is missed in play.

## Why not now

Play feels responsive today. The demo recomputes sight only when something changes (a token is dropped, a door opens), and a pause of a tenth to a quarter of a second after letting go of a token reads as instant. Everything here is contained in `engine/sight/`, `engine/fog/` and the page's drawing code, so waiting does not make it harder.

## What it costs today

Measured 2026-11-09 on Level 1 of the first campaign (693 wall segments, 44 x 58 cells, outline-traced walls), 200 ft vision, in the cloud workspace (Node 22 for the engine; headless Chromium with software rendering for the page, so real browsers with a GPU will draw faster).

| Step | Time | Notes |
|---|---|---|
| `prepare` (door states applied) | 0.7 ms | Not a problem. |
| One visibility polygon (`visPolygon`) | about 9 ms | About 2,000 rays (180 for the range circle, three per wall endpoint in range) against all 693 segments: about 1.4 million ray-segment tests. Every ray collects all its hits and sorts them (needed for limited walls). |
| One Medium PC (`tokenSight`) | about 42 ms | Five viewpoints (centre and four corners), so five polygons. |
| Party view, 2 PCs and 6 other tokens | 93 ms | 85 ms of it is the ten polygons; checking which tokens the party sees is about 5 ms. |
| Party view, 4 PCs | about 190 ms (est.) | Scales with viewpoints: 20 polygons. |
| Explored area: merge new sight | 5 ms | Rasterising polygons into the 1/8-cell mask. |
| Explored area: trace outlines | 9 ms exact, 16 ms straightened | Both re-traced from scratch on every update. |
| Page: recompute and redraw (2 PCs) | 162 ms | |
| Page: one redraw only | 37 ms | Runs on every pointer move while dragging, every zoom step and pan. Above the 16 ms a smooth 60 frames a second needs. |

Lighting (added the same day; Level 1, two PCs, one torch): a light polygon about 4 ms the first time and nothing when cached; the light-aware party view about 10 ms on top of sight; tracing the perceived, dim and greyscale areas for drawing about 20 ms. In the page: a full update with a moving torch 245 ms (162 ms before lighting); one redraw 71 ms (37 ms): the greyscale and dim overlays are clipped redraws of the map image, a candidate for the layered drawing in idea 7.

The cost is almost all ray casting: number of viewpoints x rays per polygon x segments tested per ray. The redraw is the second problem: it does not depend on sight at all, and it limits how smooth dragging and zooming feel.

## Targets

| Case | Target | Today |
|---|---|---|
| Full update, 4 PCs, Level 1, desktop | under 30 ms | about 260 ms |
| One token's sight while it is being dragged | under 4 ms | about 42 ms |
| One redraw (drag frame, zoom, pan) | under 8 ms | 37 ms |
| Full update on a phone or tablet (3 to 5 times slower) | under 150 ms | about 1 s |
| A batch of 1,000 sight queries for Claude (leak check, stealth checks) | under 1 s | tens of seconds |

## The ideas, in the order I would do them

### 1. A benchmark first

`tools/bench.mjs`: times each step above on a map and prints a table. Levels from the private pack cannot go into the public repo, so the benchmark also builds a **synthetic dungeon** (a seeded random generator of rooms, corridors, doors and thick outline walls, a few hundred to a few thousand segments) that anyone can run. Add a loose budget test on the synthetic map (fail if a full update is more than, say, twice the recorded time) so a slowdown is noticed when it happens.

### 2. Cache polygons; recompute only what changed

A viewpoint's polygon depends only on its position, the vision range and the door states. Keep polygons per token, keyed by position and range:

- One PC moves: recompute that PC's five polygons, reuse the others. Moving one of four PCs costs a quarter of a full update.
- A door opens or closes: recompute only polygons that could be affected. A polygon is affected if the door segment lies within its vision range and is visible from it, or lies on its boundary; a cheap test is whether the door segment intersects the polygon or touches its edge. Others are reused.
- Token visibility (who sees which foe) is cached per pair and invalidated the same way.

No change to sight semantics, so the existing semantics tests cover it. Expected: most updates in play touch one token and drop to a quarter or less.

### 3. A spatial index for rays

Put segments into a uniform grid (one or two cells per bucket). A ray walks the buckets along its path in order (a DDA walk) and tests only the segments in each bucket. Because buckets are visited in order of distance, the ray can stop as soon as it has its answer: the first blocking hit for normal walls, the second for limited walls, with proximity handled per segment as today. Each segment is tested once per ray (mark segments already tested).

On Level 1 a typical ray crosses a few dozen buckets holding a handful of segments each, instead of testing all 693, so a 10 to 30 times speed-up of `visPolygon` is realistic. Range culling (skipping segments beyond the vision range) comes free with it and matters more once darkvision (60 ft) and torches (20 ft) give short ranges.

The index is built once per map and door-state change (well under a millisecond) and is shared by `visPolygon`, `canSee`, `tokenCanSee` and the query tools.

Correctness guard: a property test that compares the indexed and the brute-force engine on thousands of random viewpoints and target points on the sample maps and the synthetic dungeon, including limited walls, proximity, one-way walls and open, closed and secret doors. They must agree exactly (same polygons within floating-point tolerance, same `canSee` answers).

### 4. Fewer rays where they cannot matter

- A wall endpoint that is hidden behind other walls cannot change the polygon. With the index, an endpoint can be checked cheaply before casting its three rays (a short visibility test to the endpoint), skipping a large share of the rays in a dungeon full of rooms.
- The 180 range-circle rays are only needed where the polygon actually reaches the range limit. Indoors at 200 ft it almost never does.

Smaller win than the index; do it only if the targets are still missed.

I would not replace ray casting with an angular sweep algorithm (sort endpoints once, keep the set of walls in front). It is faster in theory, but limited walls (see past one, not two) and proximity walls make the sweep complicated and fragile, and the index gets most of the benefit with the semantics untouched.

### 5. Viewpoints

A Medium token uses five viewpoints so that it can peek round a corner or through a doorway from the edge of its square. In open areas the corner polygons add almost nothing to the centre one. Options:

- While dragging, compute only the centre polygon (fast preview); compute all five when the token is dropped.
- Compute corner polygons only when a wall lies within about a cell of the token.

Both change results slightly in edge cases, so the property test compares against the full five-point answer and the fog after a drop is always the full answer.

### 6. Fog bookkeeping

- Re-trace the explored outlines (`toPolys`, `displayPolys`) only when the mask actually changed (keep a change counter in `ExploredMask.add`), and only for the tiles that changed.
- The save only needs `toPolys` when it is written, which is already delayed; the screen only needs `displayPolys` when the explored area grew.

Small but free: about 25 ms per update today.

### 7. Drawing in layers

The page redraws everything on every frame. Split it into stacked canvases:

1. The map image (redrawn only on zoom and pan).
2. The fog: explored and visible areas, softened (redrawn only when sight or the explored area changes; cached at map resolution, so zoom and pan just scale it).
3. Walls, doors and terrain marks (redrawn when doors change or the walls overlay is toggled).
4. Tokens, routes, the movement range and the drag ghost (redrawn every frame while dragging, and cheap).

Before doing this, profile one redraw to confirm where the 37 ms goes; the fog softening (a blur over the full map) is the likely main cost. Expected result: a drag frame redraws only the top layer, well under the 8 ms target.

### 8. A Web Worker for sight

Run sight in a background worker so the page never freezes, even on a slow device. The page sends token positions and door states; the worker returns polygons and the seen-token set; if a newer request arrives, the older one is dropped ("latest wins"). This is what makes live sight while dragging practical on phones. The engine is dependency-free, so the same modules load in the worker.

### 9. Light (when it arrives)

Every light source needs its own polygon, so light multiplies the cost; this is why the work above belongs with the light phase. Lights do not move often (a torch carried by a PC does), and walls move only when doors change, so static light polygons are computed once and cached exactly as in idea 2. Light uses its own sense values, so it gets its own prepared segments and index.

## Suggested order

1. Benchmark and synthetic dungeon (idea 1).
2. Polygon cache (idea 2) and fog bookkeeping (idea 6): no semantics change, immediate gain in play.
3. Spatial index with the brute-force property test (idea 3): the big gain for every caller, including Claude's tools.
4. Drawing layers (idea 7), after profiling the redraw.
5. Worker (idea 8) and viewpoint shortcuts (idea 5) only if phones or live drag sight need them.
6. Light (idea 9) on top.

Re-measure after each step and update the table at the top.
