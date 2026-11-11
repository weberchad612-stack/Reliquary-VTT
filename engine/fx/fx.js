// Visual effects: genre-neutral drawing primitives, the planner that turns a named effect into timed drawing
// jobs, and a player that draws the jobs on a canvas. Dependency-free; runs in the browser and in Node.
// Docs: docs/design/board.md section 7 (visual effects), docs/best-practices/board.md.
//
// Layers: the engine knows only primitives (shapes over time: glow, ring, particles, projectile, beam, swing,
// text...); a ruleset's library (rulesets/<id>/effects.js) composes them into its genre's effects as data; an
// adventure pack may add or restyle effects. An effect is a list of steps, each a primitive with parameters:
//   { p: 'orb', from: 'a', to: 'b', colour: 'fire', size: 0.2, ms: 360, after: 0 }
// Positions: 'a' (the source), 'b' (the target; on a miss, a point beside it), 'b0' (the target itself, even on a
// miss), 'mid'. Sizes and distances are in squares; times in ms. Colours are the library's palette names, 'main'
// (the effect's colour, or the play's override), or #hex.
//
// Attacks (effect.attack) get the shared result rules: a hit glows and sparks at the target and shakes it; a
// critical hit is bigger, with a gold ring and "CRIT!"; a miss goes wide and says "Miss". An effect may give its
// own hit, crit or miss steps instead.

const TAU = Math.PI * 2;
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** A small seeded random generator (mulberry32): the same play looks the same on every screen. */
export function makeRng(seed) {
  let s = typeof seed === 'number' ? seed >>> 0 : [...String(seed)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0), 2166136261);
  return function rng(a = 0, b = 1) {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
  };
}

/** Colours every library can use; a library's palette adds to and overrides these. */
export const BASE_PALETTE = Object.freeze({
  white: '#ffffff', grey: '#c4ccd8', gold: '#ffd45a', red: '#ff3b3b', damage: '#ff6b5e', healing: '#7dffa8',
  steel: '#e6edf5', smoke: '#6b6f78', ember: '#c23a12', flash: '#fff6c0',
});

const PIX = (env, v, d) => (v === undefined ? d : v) * env.cs;          // squares -> pixels
const angleOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * The primitives. Each has a default duration (ms), an optional init(step, env) returning its fixed random state
 * (particles), and draw(g, p, step, env, state) for progress p in [0, 1). step positions are pixels ({x, y});
 * env: {cs: pixels per square, rng, reduced, snapshot?(g, x, y, r, dx, dy)}.
 */
export const PRIMITIVES = {
  /** Radial bloom at a point. size: radius (squares). */
  glow: {
    ms: 420,
    draw(g, p, s, env) {
      const r = PIX(env, s.size, 0.8) * (0.35 + 0.9 * ease(p)), gr = g.createRadialGradient(s.at.x, s.at.y, 0, s.at.x, s.at.y, Math.max(1, r));
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, s.colour); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - p) * (s.alpha ?? 0.9); g.fillStyle = gr;
      g.beginPath(); g.arc(s.at.x, s.at.y, Math.max(1, r), 0, TAU); g.fill();
    },
  },
  /** Expanding ring. r0, r1: radii (squares); width (pixels); dash. */
  ring: {
    ms: 560,
    draw(g, p, s, env) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - p) * 0.95; g.strokeStyle = s.colour;
      g.lineWidth = (s.width || 3) * (1 - p * 0.5); if (s.dash) g.setLineDash(s.dash);
      g.shadowColor = s.colour; g.shadowBlur = 10;
      g.beginPath(); g.arc(s.at.x, s.at.y, Math.max(0.5, lerp(PIX(env, s.r0, 0.2), PIX(env, s.r1, 1.1), ease(p))), 0, TAU); g.stroke();
    },
  },
  /** Particle burst. count, speed (squares), size (pixels), gravity (squares, + down). */
  sparks: {
    ms: 520,
    init(s, env) { return Array.from({ length: s.count || 14 }, () => { const an = env.rng(0, TAU), v = env.rng(0.35, 1) * PIX(env, s.speed, 1.1); return [Math.cos(an) * v, Math.sin(an) * v, env.rng(0.6, 1.4) * (s.size || 3)]; }); },
    draw(g, p, s, env, P) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - p; g.fillStyle = s.colour;
      const e = 1 - Math.pow(1 - p, 2), grav = PIX(env, s.gravity, 0) * p * p;
      for (const q of P) { g.beginPath(); g.arc(s.at.x + q[0] * e, s.at.y + q[1] * e + grav, Math.max(0.3, q[2] * (1 - p * 0.7)), 0, TAU); g.fill(); }
    },
  },
  /** A glowing projectile on a curve, with a trail. size: radius (squares); curve; trail (points). */
  orb: {
    ms: 380,
    draw(g, p, s, env) {
      const a = s.from, b = s.to, c = s.curve || 0;
      const cx = (a.x + b.x) / 2 + c * (b.y - a.y) * 0.3, cy = (a.y + b.y) / 2 - c * (b.x - a.x) * 0.3;
      const pt = (t) => { const u = 1 - t; return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y }; };
      g.globalCompositeOperation = 'lighter'; g.shadowColor = s.colour; g.shadowBlur = 12;
      const T = s.trail ?? 8, r = PIX(env, s.size, 0.17);
      for (let i = T; i >= 0; i--) {
        const q = pt(Math.max(0, p - i * 0.018)), k = 1 - i / (T + 1);
        g.globalAlpha = k * 0.8; g.fillStyle = i ? s.colour : '#fff';
        g.beginPath(); g.arc(q.x, q.y, Math.max(0.5, r * (i ? k : 1)), 0, TAU); g.fill();
      }
    },
  },
  /** A beam that shoots from one point to another and fades. width (pixels); core colour. */
  streak: {
    ms: 300,
    draw(g, p, s) {
      const a = s.from, b = s.to, st = Math.max(0, p * 1.7 - 0.7), en = Math.min(1, p * 1.7);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - p * 0.6; g.lineCap = 'round'; g.shadowColor = s.colour; g.shadowBlur = 12;
      g.strokeStyle = s.colour; g.lineWidth = (s.width || 3) * 2.2;
      g.beginPath(); g.moveTo(lerp(a.x, b.x, st), lerp(a.y, b.y, st)); g.lineTo(lerp(a.x, b.x, en), lerp(a.y, b.y, en)); g.stroke();
      g.strokeStyle = s.core || '#fff'; g.lineWidth = s.width || 3; g.stroke();
    },
  },
  /** A weapon swing: an arc around a point. angle (radians, or 'dir'), radius (squares), sweep (radians), width. */
  arc: {
    ms: 380,
    draw(g, p, s, env) {
      const h = Math.min(1, p * 1.5), N = 16, st = s.angle - (s.sweep || 2) / 2, rad = PIX(env, s.radius, 0.95);
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.shadowColor = s.colour; g.shadowBlur = 12;
      for (let i = 0; i < N; i++) {
        const u0 = (i / N) * h, u1 = ((i + 1) / N) * h, k = (i + 1) / N;
        g.globalAlpha = Math.max(0, k * (1 - Math.max(0, p - 0.45) / 0.55)); g.strokeStyle = k > 0.8 ? '#fff' : s.colour; g.lineWidth = (s.width || 5) * k + 1;
        g.beginPath(); g.arc(s.at.x, s.at.y, rad, st + (s.sweep || 2) * u0, st + (s.sweep || 2) * u1 + 0.02); g.stroke();
      }
    },
  },
  /** Jagged lightning between two points, re-drawn every 60 ms. width (pixels); jitter (squares). */
  bolt: {
    ms: 420,
    draw(g, p, s, env) {
      const a = s.from, b = s.to, n = Math.max(4, Math.round(dist(a, b) / (env.cs * 0.45))), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const r = makeRng(Math.floor((p * (s.ms || 420)) / 60) + (s.seed || 0));
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - p * p; g.lineJoin = 'round'; g.shadowColor = s.colour; g.shadowBlur = 16;
      g.beginPath();
      for (let i = 0; i <= n; i++) { const t = i / n, j = i && i < n ? r(-1, 1) * PIX(env, s.jitter, 0.28) : 0; const x = a.x + dx * t + nx * j, y = a.y + dy * t + ny * j; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = s.colour; g.lineWidth = (s.width || 2.5) * 3; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = s.width || 2.5; g.stroke();
    },
  },
  /** Floating text rising from a point. text; size (pixels, default by square). */
  text: {
    ms: 1100,
    draw(g, p, s, env) {
      const y = s.at.y - env.cs * 0.25 - env.cs * 0.8 * ease(p);
      g.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      g.font = `800 ${Math.round(s.size || Math.max(15, env.cs * 0.62))}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.lineWidth = 4; g.lineJoin = 'round'; g.strokeStyle = '#000'; g.fillStyle = s.colour;
      g.strokeText(String(s.text), s.at.x, y); g.fillText(String(s.text), s.at.x, y);
    },
  },
  /** Symbols rising and drifting (notes, stars, Zs). chars; count; spread, rise (squares). */
  glyphs: {
    ms: 1100,
    init(s, env) { const ch = s.chars || ['✦']; return Array.from({ length: s.count || 6 }, (_, i) => [env.rng(-1, 1) * PIX(env, s.spread, 1), env.rng(0.1, 1) * PIX(env, s.rise, 1.4), env.rng(0, TAU), ch[i % ch.length], env.rng(0, 0.35)]); },
    draw(g, p, s, env, P) {
      g.fillStyle = s.colour; g.textAlign = 'center'; g.shadowColor = s.colour; g.shadowBlur = 8; g.font = `${Math.round(env.cs * 0.6)}px system-ui, sans-serif`;
      for (const q of P) {
        const t = clamp01((p - q[4]) / (1 - q[4])); if (t <= 0) continue;
        g.globalAlpha = Math.sin(Math.PI * t); g.fillText(q[3], s.at.x + q[0] + Math.sin(q[2] + t * 5) * env.cs * 0.2, s.at.y - q[1] * t + env.cs * 0.2);
      }
    },
  },
  /** A cone of particles. angle; length (squares); spread (radians); count; end colour. */
  wedge: {
    ms: 900,
    init(s, env) { return Array.from({ length: s.count || 60 }, () => [env.rng(-0.5, 0.5) * (s.spread || Math.PI / 2), env.rng(0.25, 1), env.rng(0.5, 1.5), env.rng(0, 0.5)]); },
    draw(g, p, s, env, P) {
      const len = PIX(env, s.length, 3), sp = s.spread || Math.PI / 2;
      g.globalCompositeOperation = 'lighter';
      for (const q of P) {
        const t = clamp01((p - q[3] * 0.4) / 0.7); if (t <= 0 || t >= 1) continue;
        const d = len * q[1] * Math.min(1, t * 1.6);
        g.globalAlpha = (1 - t) * 0.9; g.fillStyle = t < 0.35 ? (s.hot || '#fff6c0') : t < 0.7 ? s.colour : (s.end || s.colour);
        g.beginPath(); g.arc(s.at.x + Math.cos(s.angle + q[0]) * d, s.at.y + Math.sin(s.angle + q[0]) * d, Math.max(0.5, env.cs * 0.22 * q[2] * (0.5 + t)), 0, TAU); g.fill();
      }
      const gr = g.createRadialGradient(s.at.x, s.at.y, 0, s.at.x, s.at.y, Math.max(1, len));
      gr.addColorStop(0, s.colour); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.25 * (1 - p); g.fillStyle = gr;
      g.beginPath(); g.moveTo(s.at.x, s.at.y); g.arc(s.at.x, s.at.y, len, s.angle - sp / 2, s.angle + sp / 2); g.closePath(); g.fill();
    },
  },
  /** Fills an area's squares (a placed template): a flash that fades, with embers in each square. cells: [[x, y]] (pixels of each square's top-left). */
  fill: {
    ms: 900,
    init(s, env) { return (s.cells || []).map(() => [env.rng(0, 1), env.rng(0, 1), env.rng(0, 0.3)]); },
    draw(g, p, s, env, P) {
      const cs = env.cs, k = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = Math.max(0, k) * (s.alpha ?? 0.45); g.fillStyle = s.colour;
      for (const c of s.cells || []) g.fillRect(c.x, c.y, cs, cs);
      if (env.reduced) return;
      g.globalAlpha = Math.max(0, k) * 0.9; g.fillStyle = s.hot || '#fff6c0';
      (s.cells || []).forEach((c, i) => { const q = P[i], t = clamp01((p - q[2]) / 0.6); if (t <= 0 || t >= 1) return; g.beginPath(); g.arc(c.x + q[0] * cs, c.y + q[1] * cs - t * cs * 0.4, Math.max(0.5, cs * 0.08 * (1 - t)), 0, TAU); g.fill(); });
    },
  },
  /** A short jolt of a token: the map under it is drawn again, offset (env.snapshot). size: radius (squares). */
  shake: {
    ms: 380,
    draw(g, p, s, env) {
      if (!env.snapshot || env.reduced) return;
      const amp = env.cs * 0.08 * (1 - p), dx = Math.sin(p * 40) * amp, dy = Math.cos(p * 33) * amp * 0.5;
      env.snapshot(g, s.at.x, s.at.y, PIX(env, s.size, 0.55), dx, dy);
    },
  },
  /** A tint over a token (hit, heal, condition). size: radius (squares). */
  flash: {
    ms: 360,
    draw(g, p, s, env) {
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.sin(Math.PI * p) * (s.alpha ?? 0.45); g.fillStyle = s.colour;
      g.beginPath(); g.arc(s.at.x, s.at.y, PIX(env, s.size, 0.45), 0, TAU); g.fill();
    },
  },
  /** A sustained beam of a given width (squares) that flickers and fades (a lightning bolt along its line, a laser). */
  beam: {
    ms: 600,
    draw(g, p, s, env) {
      const a = s.from, b = s.to, w = PIX(env, s.width, 1), k = p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8, fl = 0.85 + 0.15 * Math.sin(p * 60);
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'butt'; g.shadowColor = s.colour; g.shadowBlur = 18;
      g.globalAlpha = Math.max(0, k) * 0.55 * fl; g.strokeStyle = s.colour; g.lineWidth = w;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.globalAlpha = Math.max(0, k) * fl; g.strokeStyle = s.core || '#fff'; g.lineWidth = Math.max(1.5, w * 0.18); g.stroke();
    },
  },
  /** Horizontal scan lines sweeping over a point (sci-fi: scans, holograms). size: half-height (squares). */
  scanlines: {
    ms: 900,
    draw(g, p, s, env) {
      const h = PIX(env, s.size, 0.7), w = h * 1.4, y = s.at.y - h + 2 * h * p;
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - p) * 0.8; g.strokeStyle = s.colour; g.lineWidth = 1.5;
      for (let i = -3; i <= 3; i++) { const yy = y + i * h * 0.12; if (yy < s.at.y - h || yy > s.at.y + h) continue; g.beginPath(); g.moveTo(s.at.x - w, yy); g.lineTo(s.at.x + w, yy); g.stroke(); }
      g.globalAlpha = (1 - p) * 0.15; g.fillStyle = s.colour; g.fillRect(s.at.x - w, s.at.y - h, 2 * w, 2 * h);
    },
  },
  /** Glitch: displaced coloured slices flickering over a point (sci-fi: hacks, EMP, holograms failing). */
  glitch: {
    ms: 600,
    draw(g, p, s, env) {
      const r = makeRng(Math.floor(p * 12) + (s.seed || 0)), size = PIX(env, s.size, 0.6);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        g.globalAlpha = (1 - p) * r(0.3, 0.8); g.fillStyle = i % 2 ? s.colour : (s.alt || '#ff3bd4');
        g.fillRect(s.at.x - size + r(-0.4, 0.4) * size, s.at.y - size + r(0, 2) * size, size * r(0.6, 2), Math.max(1, size * r(0.05, 0.18)));
      }
    },
  },
  /** Muzzle flash: a star-shaped burst at the barrel, facing the shot (guns, blasters). angle; size (squares). */
  muzzle: {
    ms: 140,
    draw(g, p, s, env) {
      const r = PIX(env, s.size, 0.45) * (1 - p * 0.5), an = s.angle || 0;
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - p; g.fillStyle = s.colour; g.shadowColor = s.colour; g.shadowBlur = 14;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a2 = an + (i / 10) * TAU, rr = i % 2 ? r * 0.35 : r * (i === 0 ? 1.6 : 0.8); i ? g.lineTo(s.at.x + Math.cos(a2) * rr, s.at.y + Math.sin(a2) * rr) : g.moveTo(s.at.x + Math.cos(a2) * rr, s.at.y + Math.sin(a2) * rr); }
      g.closePath(); g.fill();
    },
  },
  /** Bullet tracers: fast thin streaks, one after another (guns, autofire). count; stagger (0-1 of the time). */
  tracer: {
    ms: 360,
    draw(g, p, s) {
      const n = s.count || 3, st = s.stagger ?? 0.18;
      g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.strokeStyle = s.colour; g.lineWidth = s.width || 1.6; g.shadowColor = s.colour; g.shadowBlur = 6;
      for (let i = 0; i < n; i++) {
        const t = clamp01((p - i * st) / Math.max(0.2, 1 - (n - 1) * st)); if (t <= 0 || t >= 1) continue;
        const h = Math.min(1, t * 1.3), tail = Math.max(0, h - 0.25);
        g.globalAlpha = 1 - t * 0.3;
        g.beginPath(); g.moveTo(lerp(s.from.x, s.to.x, tail), lerp(s.from.y, s.to.y, tail)); g.lineTo(lerp(s.from.x, s.to.x, h), lerp(s.from.y, s.to.y, h)); g.stroke();
      }
    },
  },
  /** A rocket or missile with a smoke trail (modern, sci-fi). size (squares). */
  rocket: {
    ms: 700,
    init(s, env) { return Array.from({ length: 16 }, () => [env.rng(-1, 1), env.rng(0.6, 1.2)]); },
    draw(g, p, s, env, P) {
      const t = ease(p), x = lerp(s.from.x, s.to.x, t), y = lerp(s.from.y, s.to.y, t), an = angleOf(s.from, s.to), sz = PIX(env, s.size, 0.18);
      P.forEach((q, i) => {   // smoke behind it
        const tt = t - (i / P.length) * 0.5; if (tt <= 0) return;
        const sx = lerp(s.from.x, s.to.x, tt) + q[0] * sz * 0.6, sy = lerp(s.from.y, s.to.y, tt) + q[0] * sz * 0.6;
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.35 * (1 - i / P.length); g.fillStyle = s.smoke || '#8a8f99';
        g.beginPath(); g.arc(sx, sy, Math.max(0.5, sz * q[1] * (1 + i * 0.12)), 0, TAU); g.fill();
      });
      g.save(); g.translate(x, y); g.rotate(an);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1; g.fillStyle = s.flame || '#ffb347'; g.shadowColor = s.flame || '#ffb347'; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(-sz * 1.2, 0); g.lineTo(-sz * 2.4, -sz * 0.35); g.lineTo(-sz * 2.4, sz * 0.35); g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.fillStyle = s.colour;
      g.fillRect(-sz * 1.2, -sz * 0.3, sz * 2, sz * 0.6); g.beginPath(); g.moveTo(sz * 0.8, -sz * 0.3); g.lineTo(sz * 1.3, 0); g.lineTo(sz * 0.8, sz * 0.3); g.fill();
      g.restore();
    },
  },
  /** An explosion: a fireball, then smoke and debris (modern, sci-fi; fantasy uses fill and glow). size: radius (squares). */
  explosion: {
    ms: 1100,
    init(s, env) { return { debris: Array.from({ length: 18 }, () => [env.rng(0, TAU), env.rng(0.5, 1.4), env.rng(1.5, 3.5)]), smoke: Array.from({ length: 10 }, () => [env.rng(-0.6, 0.6), env.rng(-0.6, 0.6), env.rng(0.5, 1)]) }; },
    draw(g, p, s, env, st) {
      const R = PIX(env, s.size, 1.5), c = s.at;
      for (const q of st.smoke) {   // smoke rises and spreads
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.sin(Math.PI * clamp01(p * 1.2)) * 0.35; g.fillStyle = s.smoke || '#5a5d64';
        g.beginPath(); g.arc(c.x + q[0] * R * (0.6 + p), c.y + q[1] * R * (0.6 + p) - p * R * 0.5, Math.max(1, R * q[2] * (0.4 + p * 0.6)), 0, TAU); g.fill();
      }
      const fb = clamp01(p / 0.45);
      if (fb < 1) {
        const r = R * (0.3 + 0.8 * ease(fb)), gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(1, r));
        gr.addColorStop(0, '#fff6c0'); gr.addColorStop(0.35, s.colour); gr.addColorStop(0.75, s.end || '#c23a12'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - fb * 0.7; g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, Math.max(1, r), 0, TAU); g.fill();
      }
      g.globalCompositeOperation = 'lighter'; g.fillStyle = s.debris || '#ffcf70';
      for (const q of st.debris) {
        const d = R * q[1] * ease(clamp01(p * 1.4)); g.globalAlpha = 1 - p;
        g.beginPath(); g.arc(c.x + Math.cos(q[0]) * d, c.y + Math.sin(q[0]) * d + p * p * env.cs * 0.6, Math.max(0.5, q[2] * (1 - p)), 0, TAU); g.fill();
      }
    },
  },
  /** A shockwave: a fast thick ring and a pale disc behind it. size: radius (squares). */
  shockwave: {
    ms: 520,
    draw(g, p, s, env) {
      const r = PIX(env, s.size, 2) * ease(p);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - p) * 0.25; g.fillStyle = s.colour;
      g.beginPath(); g.arc(s.at.x, s.at.y, Math.max(0.5, r), 0, TAU); g.fill();
      g.globalAlpha = (1 - p) * 0.9; g.strokeStyle = s.colour; g.lineWidth = Math.max(1, env.cs * 0.18 * (1 - p));
      g.beginPath(); g.arc(s.at.x, s.at.y, Math.max(0.5, r), 0, TAU); g.stroke();
    },
  },
  /** A thrown or shot object flying on a low arc, turning or spinning. shape: arrow | bolt | javelin | dart |
   *  stone | rock | flask | boulder | bullet; arcHeight (squares); spin (turns). */
  missile: {
    ms: 480,
    draw(g, p, s, env) {
      const t = ease(Math.min(1, p * 1.1)), an = angleOf(s.from, s.to), cs = env.cs;
      const x = lerp(s.from.x, s.to.x, t), y = lerp(s.from.y, s.to.y, t) - Math.sin(Math.PI * t) * PIX(env, s.arcHeight, 0.3);
      g.save(); g.translate(x, y); g.rotate(s.spin ? p * TAU * s.spin : an + Math.cos(Math.PI * t) * (s.arcHeight ? 0.2 : 0));
      g.globalAlpha = 1; g.strokeStyle = s.colour; g.fillStyle = s.colour; g.lineCap = 'round';
      const sh = s.shape || 'arrow';
      if (sh === 'arrow' || sh === 'bolt' || sh === 'javelin' || sh === 'dart') {
        const L = cs * ({ arrow: 0.45, bolt: 0.32, javelin: 0.55, dart: 0.2 }[sh]);
        g.lineWidth = sh === 'javelin' ? 3 : 2; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
        g.fillStyle = s.tip || '#e6edf5'; g.beginPath(); g.moveTo(L + 4, 0); g.lineTo(L - 3, -3); g.lineTo(L - 3, 3); g.fill();
      } else if (sh === 'bullet') {
        g.beginPath(); g.ellipse(0, 0, cs * 0.08, cs * 0.035, 0, 0, TAU); g.fill();
      } else {
        const r = cs * ({ stone: 0.1, rock: 0.2, flask: 0.13, boulder: 0.38 }[sh] || 0.12);
        g.beginPath();
        if (sh === 'flask') { g.arc(0, 0, r, 0, TAU); g.fill(); g.fillStyle = '#d8dbe4'; g.fillRect(-r * 0.25, -r * 1.7, r * 0.5, r * 0.8); }
        else { for (let i = 0; i < 7; i++) { const a2 = (i / 7) * TAU, rr = r * (0.75 + 0.25 * Math.sin(i * 2.3)); i ? g.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) : g.moveTo(Math.cos(a2) * rr, Math.sin(a2) * rr); } g.closePath(); g.fill(); }
      }
      g.restore();
    },
  },
};

/** Primitives kept with reduced motion (short fades, no particles, flashes or shakes). */
const REDUCED_KEEP = new Set(['text', 'fill', 'beam', 'streak', 'orb', 'missile', 'tracer', 'rocket', 'glow', 'flash']);
/** With reduced motion, these become a calmer primitive instead of being dropped. */
const REDUCED_SWAP = { bolt: 'streak', explosion: 'glow', shockwave: 'glow' };

/** Plain effects every library falls back on when a name is unknown. */
export const ENGINE_EFFECTS = Object.freeze({
  hit: { group: 'Engine', label: 'Hit (plain)', attack: true, steps: [] },
  projectile: { group: 'Engine', label: 'Projectile (plain)', attack: true, impact: 360, steps: [{ p: 'orb', from: 'a', to: 'b', colour: 'main', ms: 380 }] },
  beam: { group: 'Engine', label: 'Beam (plain)', attack: true, impact: 260, steps: [{ p: 'streak', from: 'a', to: 'b', colour: 'main', width: 3 }] },
  burst: { group: 'Engine', label: 'Burst (plain)', kind: 'area', steps: [{ p: 'fill', cells: true, colour: 'main' }, { p: 'ring', at: 'b', colour: 'main', r0: 0.2, r1: 2 }] },
  buff: { group: 'Engine', label: 'Buff (plain)', steps: [{ p: 'ring', at: 'b', colour: 'main', r0: 0.2, r1: 0.9, ms: 800 }] },
});

/**
 * Find an effect by name: the pack's library first, then the ruleset's, then the engine's. An unknown name falls
 * back by the library's rules (fallbacks: [{kind, trait, effect}]) on the hint's kind and traits, else on the
 * engine's plain effect for the kind.
 * @param {string} name
 * @param {Array<object>} libs  libraries, most specific first: {via: 'pack'|'ruleset', effects: {name: effect}, fallbacks?, palette?}
 * @param {{kind?: string, traits?: string[]}} [hint]
 * @returns {{name, effect, via: 'pack'|'ruleset'|'engine'|'fallback', lib}}
 */
export function resolveEffect(name, libs, hint = {}) {
  const list = (libs || []).filter(Boolean);
  for (const lib of list) if (lib.effects && lib.effects[name]) return { name, effect: lib.effects[name], via: lib.via || 'ruleset', lib };
  if (ENGINE_EFFECTS[name]) return { name, effect: ENGINE_EFFECTS[name], via: 'engine', lib: list[list.length - 1] || {} };
  const traits = hint.traits || [];
  for (const lib of list) {
    for (const f of lib.fallbacks || []) {
      if (f.kind && f.kind !== hint.kind) continue;
      if (f.trait && !traits.includes(f.trait)) continue;
      const e = lib.effects && lib.effects[f.effect];
      if (e) return { name: f.effect, effect: e, via: 'fallback', lib };
    }
  }
  const plain = { projectile: 'projectile', ranged: 'projectile', beam: 'beam', area: 'burst', buff: 'buff', heal: 'buff' }[hint.kind] || 'hit';
  return { name: plain, effect: ENGINE_EFFECTS[plain], via: 'fallback', lib: list[list.length - 1] || {} };
}

/** A colour: a palette name, 'main' (the play's colour, else the effect's), 'dmg' (the effect's damage colour), or #hex. */
function colourOf(c, ctx) {
  if (!c || c === 'main') return ctx.colour;
  if (c === 'dmg') return ctx.dmgColour;
  if (c.startsWith('#') || c.startsWith('rgb')) return c;
  return ctx.palette[c] || ctx.colour;
}

/** Where a missed shot goes: beside the target, away from the source. */
function missPoint(a, b, cs, rng) {
  const an = angleOf(a, b) + rng(-0.35, 0.35);
  return { x: b.x + Math.cos(an) * cs * 1.6, y: b.y + Math.sin(an) * cs * 1.6 };
}

/** The shared result steps for an attack effect. */
function resultSteps(result, at) {
  if (result === 'miss') return [{ p: 'text', at: 'b0', text: '$text|Miss', colour: 'grey', ms: 900, after: at }];
  const crit = result === 'crit';
  const s = [
    { p: 'glow', at: 'b', colour: 'dmg', size: crit ? 1.5 : 0.8, ms: 420, after: at },
    { p: 'sparks', at: 'b', colour: 'dmg', count: crit ? 30 : 14, speed: crit ? 1.8 : 1.1, size: 3.5, ms: 520, after: at },
    { p: 'shake', at: 'b', ms: 380, after: at },
  ];
  if (crit) s.push({ p: 'ring', at: 'b', colour: 'gold', r0: 0.2, r1: 1.6, width: 4, ms: 560, after: at }, { p: 'text', at: 'b', text: 'CRIT!', colour: 'gold', size: 0, ms: 1100, after: at, lift: 0.75 });
  return s;
}

/**
 * Turn an effect into timed drawing jobs.
 * @param {object} effect  a library effect: {steps, attack?, impact?, kind?, colour?, traits?, hit?, crit?, miss?, textAt?}
 * @param {object} ctx
 *   a, b: source and target ({x, y} pixels; b may be missing for effects at the source);
 *   cells: [{x, y}] pixels of the area's squares (area effects); cs: pixels per square;
 *   o: {result: 'hit'|'crit'|'miss', text, n, colour}; palette: {name: '#hex'} (the library's, over BASE_PALETTE);
 *   rng: makeRng(seed); reduced: reduced motion
 * @returns {Array<{p, after, ms, s}>}  s: the step with positions in pixels and colours resolved
 */
export function planEffect(effect, ctx) {
  const o = ctx.o || {}, rng = ctx.rng || makeRng(1), cs = ctx.cs, palette = { ...BASE_PALETTE, ...(ctx.palette || {}) };
  const traitColour = (effect.traits || []).map((t) => palette[t]).find(Boolean);
  const cctx = { palette, colour: o.colour || (effect.colour && (palette[effect.colour] || effect.colour)) || traitColour || palette.white, dmgColour: (effect.colour && (palette[effect.colour] || effect.colour)) || traitColour || palette.white };
  if (o.colour) cctx.dmgColour = o.colour;
  const a = ctx.a, b0 = ctx.b || ctx.a, result = effect.attack ? (o.result || 'hit') : null;
  const b = result === 'miss' ? missPoint(a || b0, b0, cs, rng) : b0;
  const lifted = (pt, lift) => (pt && lift ? { x: pt.x, y: pt.y - lift * cs } : pt);
  const point = (ref, lift) => {
    if (ref === 'a') return lifted(a || b0, lift);
    if (ref === 'b') return lifted(b, lift);
    if (ref === 'b0') return lifted(b0, lift);
    if (ref === 'mid') return lifted({ x: ((a || b0).x + b0.x) / 2, y: ((a || b0).y + b0.y) / 2 }, lift);
    if (ref && typeof ref === 'object' && 'x' in ref) return ref;
    return lifted(b0, lift);
  };
  // the attack's own steps, then the shared (or the effect's own) result steps
  const impact = effect.impact ?? Math.max(0, ...effect.steps.map((s) => (s.after || 0) + (s.ms || (PRIMITIVES[s.p] || {}).ms || 400) * 0.9));
  let steps = [...effect.steps];
  if (result) steps = steps.concat(effect[result] || resultSteps(result, impact));
  if (o.text && result !== 'miss') steps.push({ p: 'text', at: result ? 'b' : (ctx.b ? 'b' : 'a'), text: o.text, colour: /^\+/.test(o.text) ? 'healing' : /^-/.test(o.text) ? 'damage' : 'main', ms: 1200, after: (result ? impact : (effect.textAt ?? 300)) + (result === 'crit' ? 260 : 0) });
  const jobs = [];
  for (const st of steps) {
    let prim = st.p;
    if (ctx.reduced && REDUCED_SWAP[prim]) prim = REDUCED_SWAP[prim];
    if (ctx.reduced && !REDUCED_KEEP.has(prim)) continue;
    const reps = st.repeat === 'n' ? Math.max(1, Math.min(st.max || 5, o.n || st.default || 3)) : (st.repeat || 1);
    for (let i = 0; i < reps; i++) {
      const s = { ...st, p: prim };
      if (reps > 1 && st.vary) for (const [k, [lo, hi]] of Object.entries(st.vary)) s[k] = lerp(lo, hi, reps === 1 ? 0.5 : i / (reps - 1));
      for (const k of ['at', 'from', 'to']) if (k in st) s[k] = point(st[k], st.lift);
      if (!('at' in st) && !('from' in st)) s.at = point('b', st.lift);
      if (st.angle === 'dir' || st.angle === undefined) s.angle = angleOf(a || b0, b0.x === (a || b0).x && b0.y === (a || b0).y ? { x: b0.x + 1, y: b0.y } : b0);
      if (st.back) { const an = angleOf(a || b0, b0), k = 'from' in st ? 'from' : 'at'; s[k] = { x: s[k].x - Math.cos(an) * cs * st.back, y: s[k].y - Math.sin(an) * cs * st.back }; }
      if (typeof st.text === 'string' && st.text.startsWith('$text|')) s.text = (result !== 'miss' && o.text) || st.text.slice(6);   // a miss never shows the play's (damage) text
      s.colour = colourOf(st.colour, cctx);
      for (const k of ['end', 'hot', 'core', 'alt', 'smoke', 'flame', 'debris', 'tip']) if (st[k]) s[k] = colourOf(st[k], cctx);
      if (st.cells) s.cells = ctx.cells || [];
      s.seed = Math.floor(rng(0, 1e6));
      s.ms = st.ms || (PRIMITIVES[prim] || {}).ms || 400;
      if (prim === 'glow' && st.p !== 'glow' && !s.at) s.at = point('b');
      jobs.push({ p: prim, after: (st.after || 0) + i * (st.stagger || 0), ms: s.ms, s });
    }
  }
  return jobs;
}

/** Check a library's effects: every step uses a known primitive and every colour is known. Returns problems. */
export function checkLibrary(lib, base = {}) {
  const out = [], palette = { ...BASE_PALETTE, ...(base.palette || {}), ...(lib.palette || {}) };
  const known = (c) => !c || c === 'main' || c === 'dmg' || c.startsWith('#') || c.startsWith('rgb') || palette[c];
  for (const [name, e] of Object.entries(lib.effects || {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) out.push(`${name}: names are lower case with underscores`);
    if (!Array.isArray(e.steps)) { out.push(`${name}: no steps`); continue; }
    if (!e.group || !e.label) out.push(`${name}: needs a group and a label`);
    for (const [i, s] of [...e.steps, ...(e.hit || []), ...(e.crit || []), ...(e.miss || [])].entries()) {
      if (!PRIMITIVES[s.p]) out.push(`${name}: step ${i}: unknown primitive "${s.p}"`);
      for (const k of ['colour', 'end', 'hot', 'core', 'alt', 'smoke', 'flame', 'debris', 'tip']) if (s[k] && !known(s[k])) out.push(`${name}: step ${i}: unknown colour "${s[k]}"`);
    }
    for (const t of e.traits || []) if (!palette[t] && !(lib.knownTraits || []).includes(t)) out.push(`${name}: trait "${t}" has no palette colour`);
  }
  for (const f of lib.fallbacks || []) if (!(lib.effects || {})[f.effect]) out.push(`fallback to unknown effect "${f.effect}"`);
  return out;
}

/** Plays jobs: add() at a time, draw() each frame until nothing is left. */
export class FxPlayer {
  constructor() { this.jobs = []; }
  /** Queue planned jobs starting at `now` (ms); env as for the primitives. */
  add(jobs, now, env) {
    for (const j of jobs) {
      const prim = PRIMITIVES[j.p];
      if (!prim) continue;
      this.jobs.push({ ...j, t0: now + (j.after || 0), env, state: prim.init ? prim.init(j.s, env) : null });
    }
  }
  get busy() { return this.jobs.length > 0; }
  clear() { this.jobs = []; }
  /** Draw every live job at time now; returns true while any job is still to come. */
  draw(g, now) {
    const live = [];
    for (const j of this.jobs) {
      const p = (now - j.t0) / j.ms;
      if (p >= 1) continue;
      live.push(j);
      if (p < 0) continue;
      g.save();
      try { PRIMITIVES[j.p].draw(g, p, j.s, j.env, j.state); } catch (e) { this.lastError = String((e && e.stack) || e); }
      g.restore();
    }
    this.jobs = live;
    return live.length > 0;
  }
}
