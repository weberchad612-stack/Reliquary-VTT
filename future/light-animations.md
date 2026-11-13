# Light animations beyond the first set

Status: ideas, not scheduled. Agreed with the user on 2026-11-10 while planning light flicker. The first set
(Group 1 below) is built (lighting design section 14); this document records how the rest could be added and what each needs.
The list of animation types follows Foundry VTT's, which the user reviewed; the descriptions here are ours.

## Ground rules (all groups)

- **Drawing only.** An animation never changes the rules: a light's bright and dim radii, and so who is
  concealed or unseen, stay fixed. Only how the light looks moves.
- **Never redraw the board per frame.** A full redraw of the Sample Keep takes about 60 ms. Animations draw
  on their own layer over the map, cleared and redrawn each frame from pictures prepared once (or once per
  move of a carried light). The rest of the board redraws only when something changes, as now.
- **Fog-aware.** For players the animation layer is clipped to what they perceive now, so an animated light
  never gives away an unseen room; while looking through one creature's eyes, to its view.
- **Per-light settings**, as in Foundry: `type`, `speed` (1-10), `intensity` (1-10, how strong the effect
  is), `reverse` (on/off: direction of rotation, ripples or colour cycling). Presets give defaults; the GM
  changes them in play from the Lighting card and a token's selection panel; the save keeps the changes.
- **The GM's table-wide switch** turns all animation off; when off, nothing animates and no frames run.
- **Measure first.** Each group adds a frame cost. The demo's frame-time readout (built with Group 1) is
  how to judge it on real machines before adding the next group.

## Group 1: brightness and colour over time (built)

Torch, Flickering Light, Pulse, Ghostly Light, Chroma. Each is one number per light per frame (a
brightness or a hue), applied to that light's prepared glow picture with `globalAlpha` or a colour
change: a few image draws per frame in all.

## Group 2: moving shapes from pictures drawn once

Moderate cost: each frame turns, scales or moves a picture prepared once per light, clipped to the
light's area (its patch, so walls still bound it).

| Animation | What it looks like | How |
|---|---|---|
| Revolving Light | One or more bright beams sweeping round the light | A cone-shaped glow picture, rotated each frame (`reverse` turns the other way) |
| Siren Light | Two opposite coloured beams sweeping, like a warning light | As Revolving Light, two beams, the light's colour |
| Sunburst | Rays from the centre, slowly turning | A ray-pattern picture, rotated |
| Radial Rainbow | Rainbow rings round the light | A ring-gradient picture; slow hue drift |
| Fairy Light | Small sparkles drifting and twinkling inside the light | A handful of sparkle sprites per light, positions and alpha moved each frame |
| Star Light | Points of light twinkling in place | Fixed sparkle positions, alpha twinkling |
| Pulsing Wave | Rings rippling outward from the light | A ring picture scaled up and faded out, a few at once |

Needs: a sprite cache per light keyed like the light cache (position, radii, doors), and clipping each
picture to the light's own reach so beams do not cross walls. Expect a few draws per light per frame;
fine for a handful of lights, worth measuring with dozens.

## Group 3: churning textures (needs a WebGL layer)

Energy Field, Force Grid, Hexa Dome, Light Dome, Mysterious Emanation, Smoke Patch, Swirling Fog,
Swirling Rainbow, Vortex.

These are procedural textures (noise, swirls, grids) recomputed for every pixel of the light every frame.
With the 2D canvas that is a per-pixel loop per frame: too slow, the very cost the user is wary of.
Done properly they need a small WebGL layer over the map running a fragment shader per animation type,
fed each light's position, radii, colour, speed and intensity, and masked by the light's patch (uploaded
as a texture when the light changes). That layer would also take over Groups 1 and 2 cheaply, so it is
the natural point to move all light animation to the graphics card.

Needs: the WebGL layer and a fallback (no animation) where WebGL is unavailable; shader sources written
for this project (not copied); tests that the masks still respect walls and the fog.

## Group 4: needs other systems

- **Sound-Reactive Pulse:** brightness follows the loudness of the table's music or ambient sound. The audio
  system exists now (engine/sound, 2026-11-13): add an analyser node on the music and ambience channels
  (`SoundMixer`), and it becomes a Group 1 animation driven by an audio level instead of a clock. Each
  screen hears its own mix, so screens would pulse a little differently.

## Overlapping animated lights: flicker by share (proposed 2026-11-10)

**Today** each animated light draws its own flicker over its whole area, unaware of the others. Where lights
overlap, the flickers simply add:

- two torches overlapping flicker twice over in the overlap, busier than either torch alone;
- a torch whose dim fringe runs into a strong steady light (a magical light, daylight, a bright region)
  still flickers that area fully, though the steady light gives most of the light there.

**Proposal:** each light flickers only by its share of the light at each point. What the eye sees is the sum
of the lights, so when one source wavers the total wavers by that source's share:

    change at a point = sum over animated lights of (its brightness there / all light there) x (its swing)

- One torch alone: it flickers fully, as now.
- Two equal torches overlapping: each counts for half; their flickers partly cancel, so the overlap is a
  little calmer than either torch, as two real flames look.
- A torch's faint edge against a strong steady light: its share is tiny, so that area stays nearly steady.
- Chroma: its hue shift is weighted the same way, matching how colours already mix by brightness.
- The flame weighting (a steady core, a moving fringe) still applies within each light's share.

**How:** the light map keeps one more value per point, the total brightness of every source (lights,
regions, daylight, the sky). Each animated light's flicker pictures take their alpha from its own brightness
divided by that total. The pictures must then be remade when any light near them changes or moves (Kerra's
torch walking past a brazier): a small one-off rebuild keyed on the light map, never a per-frame cost, so
the frame rate is unchanged.

**Rejected:** letting only the brightest light at each point animate. It leaves visible seams where one
light takes over from another.

## Open questions for later

- Should carried lights get Group 2 and 3 animations, or only static ones (a sweeping beam on a moving
  token)?
- Should an animation be able to change the rules for a moment (a light that winks out entirely)? So far
  every animation is drawing only; a light that really goes out is the on/off switch.
