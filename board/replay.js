// Replay: a batch of resolved actions that the table watches step by step (the user's design, 2026-11-12). Pure;
// board/replayui.js draws the tab and plays the steps, tools/replay.mjs writes the records. Docs: docs/design/game-data.md
// section 3.4, docs/best-practices/board.md (replay).
//
// Claude resolves a batch in a draft (tools/replay.mjs): the game's records change in a working copy only, and each
// step keeps what it changes. Nothing reaches the game until a step is revealed: then the board that revealed it
// writes that step's changes for real, so results never sit in the database early. Anyone may press Next; the step
// counter is shared, so every screen follows.
//
// A replay, replay/<id>:
//   {title, by, created (ISO), map?, steps: [step], narration: [text], stop?: text (waiting for reactions),
//    n (steps revealed), revealed: [{at (ISO), key}] (one per revealed step: when and by whose press)}
// A step:
//   {side: 'pc' | 'npc' | 'env', actor? (token id), who? (shown name), text, gm? (the GM's only: players see
//    "Something happens…"), focus? [token ids or [x, y]] (the camera's points; else the actor, the moves and fx),
//    changes: [change], posts: [{c: 'chat' | 'dice' | 'audit' | 'fx', data}], moves: [{token, from, to, via?}]}
// A change to one record, by its top-level fields:
//   {path, to: {k: v} (fields set), unset?: [k] (fields removed), from: {k: v} (those fields before),
//    fromUnset?: [k] (fields that were absent before), create?: true (no record before), remove?: true (deleted)}
// Posts are the step's chat messages, dice, audit lines and visual effects; they get their paths and times when the
// step is revealed (time-ordered with everything else), from the reveal's key, so two screens revealing the same
// step write the same records.

export const REPLAY = 'replay';
export const SIDES = Object.freeze(['pc', 'npc', 'env']);
export const POSTS = Object.freeze(['chat', 'dice', 'audit', 'fx']);
export const CLAIM_WAIT = 700;   // ms a board waits after claiming a step before it reads the claim back

const canon = (v) => JSON.stringify(sortKeys(v));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export const same = (a, b) => canon(a) === canon(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A new replay id: time-sortable. */
export function replayId(now = Date.now(), rnd = Math.random) {
  return `${Math.floor(now).toString(36).padStart(9, '0')}-${rnd().toString(36).slice(2, 6)}`;
}

/** The change that turns record `before` (or null) into `after` (or null); null when nothing changes. */
export function diffRecord(path, before, after) {
  if (!before && !after) return null;
  if (before && !after) return { path, remove: true, to: {}, from: clone(before) };
  const b = before || {}, to = {}, from = {}, unset = [], fromUnset = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(after)])) {
    const has = k in after, had = k in b;
    if (has && had && same(b[k], after[k])) continue;
    if (has) to[k] = clone(after[k]); else unset.push(k);
    if (had) from[k] = clone(b[k]); else fromUnset.push(k);
  }
  if (!Object.keys(to).length && !unset.length && before) return null;
  const c = { path, to, from };
  if (unset.length) c.unset = unset;
  if (fromUnset.length) c.fromUnset = fromUnset;
  if (!before) c.create = true;
  return c;
}

/** A record with a change applied (null when the change deletes it). Fields the change does not touch stay. */
export function applyChange(current, c) {
  if (c.remove) return null;
  const out = { ...(current || {}) };
  for (const [k, v] of Object.entries(c.to || {})) out[k] = clone(v);
  for (const k of c.unset || []) delete out[k];
  return out;
}

/** The fields of a change that someone else changed since the replay was made: [k] (empty when none). */
export function conflicts(current, c) {
  if (c.create) return current ? ['(the record exists already)'] : [];
  if (!current) return ['(the record is gone)'];
  const out = [];
  for (const k of Object.keys(c.from || {})) if (!same(current[k], c.from[k])) out.push(k);
  for (const k of c.fromUnset || []) if (k in current) out.push(k);
  return out;
}

const t36 = (ms) => Math.floor(ms).toString(36).padStart(9, '0');
/** The path of a step's post when revealed at `at` (ms) by `key`: time-sortable with the rest of its collection, and
 *  the same on every screen that reveals the step with that key. */
export function postPath(c, at, key, k, i) {
  const tag = `${String(key).slice(0, 6)}${k.toString(36)}x${i.toString(36)}`;
  if (c === 'fx') return `fx/${Math.floor(at)}-r${tag}`;
  return `${c}/${t36(at)}-r${tag}`;
}

/** A post's record as revealed: its time set to the reveal's. */
export function postData(p, at) {
  const d = clone(p.data) || {};
  if (p.c === 'fx') d.ts = Math.floor(at); else d.at = new Date(at).toISOString();
  return d;
}

/** The narration as chat messages, revealed with the last step. */
export function narrationPosts(rep) {
  return (rep.narration || []).filter((t) => String(t || '').trim()).map((text) => ({ c: 'chat', data: { by: 'claude', kind: 'narration', text: String(text).trim(), ...(rep.map ? { map: rep.map } : {}) } }));
}

/**
 * What revealing step k writes, given the records as they are now ({path: data|null}): [{op: 'set'|'remove', path,
 * data?}], plus warnings for fields someone changed since the replay was made (the replay still wins).
 */
export function stepWrites(rep, k, current, { at, key }) {
  const step = rep.steps[k], ops = [], warnings = [];
  for (const c of step.changes || []) {
    const now = current[c.path] ?? null, bad = conflicts(now, c);
    // a record that is gone is not made again from a few of its fields (half a record breaks its readers)
    if (!now && !c.create && !c.remove) { warnings.push(`${c.path}: the record is gone since the replay was made; this change was skipped`); continue; }
    if (bad.length) warnings.push(`${c.path}: ${bad.join(', ')} changed since the replay was made; the replay's values were applied`);
    const next = applyChange(now, c);
    ops.push(next ? { op: 'set', path: c.path, data: next } : { op: 'remove', path: c.path });
  }
  const posts = [...(step.posts || []), ...(k === rep.steps.length - 1 ? narrationPosts(rep) : [])];
  posts.forEach((p, i) => { if (POSTS.includes(p.c)) ops.push({ op: 'set', path: postPath(p.c, at, key, k, i), data: postData(p, at) }); });
  return { ops, warnings };
}

/** The replay to show: the oldest one not finished (batches are revealed in order: a later one was resolved as if
 *  the earlier ones had happened), else the newest one; null when there is none. */
export function currentReplay(list) {
  const all = [...(list || [])].filter((e) => e && e.data && Array.isArray(e.data.steps)).sort((a, b) => (a.id < b.id ? -1 : 1));
  return all.find((e) => (e.data.n || 0) < e.data.steps.length) || all.at(-1) || null;
}

/** The replays waiting behind the one shown (not finished): how many. */
export const waitingBehind = (list, cur) => (list || []).filter((e) => e && e.data && Array.isArray(e.data.steps) && e.id !== (cur && cur.id) && (e.data.n || 0) < e.data.steps.length).length;

export const remaining = (rep) => (rep ? Math.max(0, rep.steps.length - (rep.n || 0)) : 0);

/** The claim a press of Next writes: step n revealed now with this key. */
export function claim(rep, { at, key }) {
  const n = rep.n || 0;
  return { n: n + 1, revealed: [...(rep.revealed || []).slice(0, n), { at: new Date(at).toISOString(), key }] };
}

/** Whether this screen's claim of step k stood (another screen pressing at the same moment may have won). */
export const claimStood = (rep, k, key) => !!(rep && rep.revealed && rep.revealed[k] && rep.revealed[k].key === key);

/** The points the camera frames for a step (token ids or [x, y] cells). */
export function focusOf(step) {
  if (step.focus && step.focus.length) return step.focus;
  const pts = [];
  if (step.actor) pts.push(step.actor);
  for (const m of step.moves || []) pts.push(m.to);
  for (const p of step.posts || []) if (p.c === 'fx' && p.data) for (const x of [p.data.from, ...[].concat(p.data.to || [])]) if (x !== undefined && x !== 'targets' && !/^template:/.test(String(x))) pts.push(x);
  return pts;
}

/** Check a replay record; returns problems in words (empty when good). */
export function checkReplay(rep) {
  const out = [];
  if (!rep || typeof rep !== 'object') return ['a replay is an object'];
  if (!Array.isArray(rep.steps) || !rep.steps.length) out.push('a replay needs at least one step');
  (rep.steps || []).forEach((s, i) => {
    const at = `step ${i + 1}`;
    if (!SIDES.includes(s.side)) out.push(`${at}: side is one of ${SIDES.join(', ')}`);
    if (!String(s.text || '').trim()) out.push(`${at}: a step needs text`);
    for (const c of s.changes || []) if (!/^[^/]+\/[^/]+$/.test(String(c.path))) out.push(`${at}: change path "${c.path}" is not collection/record`);
    for (const p of s.posts || []) if (!POSTS.includes(p.c)) out.push(`${at}: a post is one of ${POSTS.join(', ')}`);
  });
  const n = rep.n || 0;
  if (n < 0 || n > (rep.steps || []).length) out.push('n is out of range');
  return out;
}

// ---------- "Claude is adjudicating" (state/adjudicating) ----------
// tools/replay.mjs writes {by, since, at} when Claude starts a batch, refreshes `at` with every step, and deletes it
// when done. Every screen shows a banner while it is there: "Claude is thinking", one line picked at random for the
// whole time, and the time elapsed. A screen times it from when it last saw the record
// change (clocks differ between machines): quiet for SLOW, the banner says it is still working with the time; quiet
// for STALE, the banner goes (the GM's board then deletes the record and notes it in the audit log).
export const ADJ_PATH = 'state/adjudicating';
export const ADJ_SLOW = 5 * 60 * 1000;
export const ADJ_STALE = 30 * 60 * 1000;

/** 'off' | 'busy' | 'slow' | 'stale' for a record seen (changed) at `seen` (this screen's ms), now `now`. */
export function adjState(rec, seen, now) {
  if (!rec) return 'off';
  const quiet = now - seen;
  return quiet >= ADJ_STALE ? 'stale' : quiet >= ADJ_SLOW ? 'slow' : 'busy';
}

/** The banner's lines: for any game and any world, and never what is being worked out. */
export const ADJ_LINES = Object.freeze([
  'The story is catching its breath…', 'Fate is doing the math…', 'Weighing the consequences…', 'The narrator clears their throat…',
  "Untangling the chaos you've caused…", 'The table holds its breath…', 'Reckoning what just happened…', 'Somewhere, the odds are being calculated…',
  'Counting the squares. Twice.', "Checking who's standing where, and who's standing at all…", 'Polishing the next twist…', 'The ink is still wet on this chapter…',
  'Consulting the fine print of reality…', 'Fortune is making up its mind…', 'The world is reacting…', 'Hold that thought…',
  'Cause, meet effect…', 'The plot thickens. Please stir.', 'Tallying the damage, figuratively and otherwise…', 'Chance is shuffling its feet…',
  'Reality is buffering…', 'The scene is being set…', 'Every action has a reaction. Finding it…', 'Rewinding the moment to see it clearly…',
  'Turning the page…', 'The narrator is choosing their words carefully…', 'Something is about to happen. Probably.', 'Luck is checking its pockets…',
  'Sorting out who did what to whom…', 'The dust is still settling…', 'Measuring twice, narrating once…', 'The universe is taking notes…',
  'Weaving the threads together…', 'Your choices are being considered…', 'One moment while the world catches up…', 'Not everything goes according to plan…',
  'Drawing the next scene…', 'Fate rarely hurries…', 'The outcome is coming into focus…', 'Even chaos needs a moment…',
  'Lining up the dominoes…', "Accounting for everyone's bad decisions…", 'The story is deciding how it feels about that…', 'A pause for dramatic effect…',
  'The board is thinking…', 'Picking up the pieces…', 'Reading the room…', "Some things can't be rushed…",
  'Cue the suspense…', 'And then…',
]);

/** The banner's line: one picked at random for the whole of an adjudication (the user, 2026-11-12: no cycling), the
 *  same on every screen (chosen from the record's start time). */
export function adjLine(rec, lines = ADJ_LINES) {
  const seed = Math.floor((Date.parse((rec && rec.since) || '') || 0) / 1000);
  return lines[Math.abs((seed * 7919) % lines.length)];
}

/** "0:42", "12:05", "1:02:10" for an elapsed time in ms. */
export function elapsedWords(ms) {
  const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** "4 min" or "1 h 12 min" for a quiet time in ms. */
export function quietWords(ms) {
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
