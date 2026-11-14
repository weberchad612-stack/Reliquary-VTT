// Pathfinder 2E stat blocks as printed in an adventure book, for the adventure importer's stat block matching
// (tools/advimport/statmatch.mjs, docs/best-practices/adventure-importer.md). A stat block is a line of capitals naming
// the creature ("CENTIPEDES, GIANT (3)") followed within a few lines by "Perception +N"; its numbers (Perception, AC,
// saves, HP, Speeds, Strikes) are read and compared with an open-content creature. The verdict: "weak" (everything 2
// lower and HP down), "elite" (2 higher, HP up), "hp" (only HP), "differs" or "same".

const HEAD = /^[A-Z][A-Z ,'’-]{3,}(\(\d+\))?$/;
// headings that are page furniture, not creatures; the book's own running heads come in as `skip`
const NOT_HEAD = /^(EXPERIENCE POINTS|TREASURE|1 SQUARE|GAME MASTER)/;

/**
 * The stat blocks printed on one page of text.
 * @param {string} text  the page (pdftotext)
 * @param {number} page
 * @param {{skip?: RegExp}} [opts]  the book's running heads and other capitals lines that are not creatures
 */
export function parseBlocks(text, page, { skip = null } = {}) {
  const notHead = (l) => NOT_HEAD.test(l) || (skip && skip.test(l));
  const lines = text.split('\n').map((l) => l.trim());
  const out = [];
  const claimed = new Set();
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    if (!HEAD.test(head) || notHead(head)) continue;
    heads.push(i);
    // its Perception line, before any other heading (a map caption or an XP box may sit between)
    let j = -1;
    for (let k = i + 1; k < Math.min(lines.length, i + 30); k++) {
      if (/^Perception [+-]\d+/.test(lines[k])) { j = k - i - 1; break; }
      if (/^[A-Z][A-Z ,'’-]{3,}(\(\d+\))?$/.test(lines[k]) && !/^(EXPERIENCE POINTS|1 SQUARE|[A-Z]\d+\.)/.test(lines[k])) break;
    }
    if (j < 0) continue;
    claimed.add(i + 1 + j);
    out.push(block(lines, i, i + 1 + j, page, notHead));
  }
  // two-column pages: a heading whose stat lines were laid out further down takes the next unclaimed Perception line
  const free = lines.map((l, k) => k).filter((k) => /^Perception [+-]\d+/.test(lines[k]) && !claimed.has(k));
  for (const i of heads) {
    if (out.some((b) => b.line === i) || !/\(\d+\)$|^[A-Z]+ [A-Z]+/.test(lines[i])) continue;
    const k = free.find((x) => x > i);
    if (k === undefined) continue;
    free.splice(free.indexOf(k), 1);
    out.push(block(lines, i, k, page, notHead));
  }
  return out.sort((a, b) => a.line - b.line);
}

function block(lines, i, start, page, notHead) {
  const head = lines[i];
  {
    const body = [];
    for (let k = start; k < Math.min(lines.length, start + 30); k++) {
      if (k > start && HEAD.test(lines[k]) && !notHead(lines[k])) break;
      body.push(lines[k]);
    }
    const all = body.join('\n');
    const num = (re) => { const m = re.exec(all); return m ? Number(m[1]) : null; };
    const strikes = [...all.matchAll(/(?:Melee|Ranged)(?: Strike)? \[one-action\] ([a-z ]+?) ([+-]\d+)/g)].map((m) => ({ name: m[1].trim(), attack: Number(m[2]) }));
    const speeds = {};
    const sp = /Stride \[one-action\] ([^\n]+)/.exec(all);
    if (sp) {
      const land = /^(\d+) feet/.exec(sp[1]); if (land) speeds.land = Number(land[1]);
      for (const m of sp[1].matchAll(/(fly|swim|climb|burrow) (\d+) feet/g)) speeds[m[1]] = Number(m[2]);
    }
    const count = Number((/\((\d+)\)$/.exec(head) || [])[1] || 1);
    return {
      page, line: i, head, count, name: head.replace(/\s*\(\d+\)$/, ''),
      perception: num(/Perception ([+-]\d+)/), ac: num(/AC (\d+)/), hp: num(/HP (\d+)/),
      saves: { fortitude: num(/Fort ([+-]\d+)/), reflex: num(/Ref ([+-]\d+)/), will: num(/Will ([+-]\d+)/) },
      speeds, strikes,
    };
  }
}

/** The printed block's numbers against an open-content creature: every difference, and what they add up to. */
export function compare(b, doc) {
  const norm = (x) => x.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const s = doc.stats || {}, diffs = [];
  const cmp = (label, book, open) => { if (book !== null && book !== undefined && open !== undefined && book !== open) diffs.push({ what: label, book, open }); };
  cmp('Perception', b.perception, s.perception);
  cmp('AC', b.ac, s.ac);
  cmp('HP', b.hp, s.hp);
  for (const k of ['fortitude', 'reflex', 'will']) cmp(k, b.saves[k], (s.saves || {})[k]);
  for (const [k, v] of Object.entries(b.speeds)) cmp(`${k} Speed`, v, (s.speeds || {})[k]);
  const strikes = (doc.items || []).filter((i) => i.kind === 'strike');
  for (const st of b.strikes) {
    const o = strikes.find((x) => norm(x.name) === norm(st.name)) || strikes.find((x) => norm(x.name).includes(norm(st.name).split(' ').at(-1)));
    if (o) cmp(`${st.name} attack`, st.attack, o.attack);
  }
  const deltas = diffs.filter((d) => d.what !== 'HP' && !/Speed/.test(d.what)).map((d) => d.book - d.open);
  const hp = diffs.find((d) => d.what === 'HP');
  let verdict = diffs.length ? 'differs' : 'same';
  if (deltas.length >= 3 && deltas.every((d) => d === -2) && (!hp || hp.book < hp.open)) verdict = 'weak';
  else if (deltas.length >= 3 && deltas.every((d) => d === 2) && (!hp || hp.book > hp.open)) verdict = 'elite';
  else if (diffs.length && diffs.every((d) => d.what === 'HP')) verdict = 'hp';
  return { diffs, verdict };
}

/** Content sources that hold no creatures (skipped when looking for candidates). */
export const NOT_CREATURES = /equipment|hazards/;

// ---- the area checklist (tools/advimport/areas.mjs, #14) and proposals from the text (#15) ----
// What one keyed area's text asks of the map and the notes, as facts: {kind, ..., at} where `at` is a few words of
// context for the report (shown to Claude at run time, never stored). Kinds: dc (a check and its DC), door (a door
// that is locked, stuck, barred or secret), lock (something else that is locked), light (dark, dim or bright, or a
// light source), terrain (difficult, greater difficult, hazardous, water to swim), treasure.

const SKILLS = 'Acrobatics|Arcana|Athletics|Crafting|Deception|Diplomacy|Intimidation|Lore|Medicine|Nature|Occultism|Performance|Religion|Society|Stealth|Survival|Thievery|Perception|Fortitude|Reflex|Will';
const around = (s, i, n = 6) => s.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, ' ').trim().split(' ').slice(0, n * 2).join(' ');

/** The facts in one area's text. */
// Event phrasing (future/adventure-events.md, "Find and check"): something that happens when a condition is met. Each
// pattern names the kind of event it suggests; the checklist asks that an adventure.json event covers the area.
const EVENT_PHRASES = [
  ['timed', /\b(at night|each night|every night|at dawn|at dusk|at midnight|the next (?:day|night|morning)|the following (?:day|night|morning)|\d+ (?:hours|days|minutes) (?:later|after|pass)|after (?:an hour|a day|a week|\d+ (?:hours|days|rounds)))\b/i],
  ['combat', /\b(reinforcements?|joins? the (?:fight|combat|battle|fray)|on the (?:second|third|fourth|fifth) round|at the (?:start|end) of the (?:second|third|fourth|fifth) round|(?:reduced to|falls? (?:to|below)) half (?:its|their) Hit Points|below half (?:its|their) Hit Points|arrives? (?:in|after) \d+ rounds|(?:comes?|come running) to investigate|investigates? the (?:noise|sounds of combat|commotion))\b/i],
  ['trigger', /\b(?:once|when|if|as soon as|after) the (?:PCs|heroes|party|characters) (?:have |are |first )?(?:defeat(?:ed)?|kill(?:ed)?|open(?:ed)?|touch(?:ed)?|leave|left|rest(?:ed)?|return(?:ed)?|linger|wait|take too long|fail(?:ed)?|refuse|solve[ds]?|destroy(?:ed)?|free[ds]?|ring|pull|activate[ds]?|reach level|are level)\b|\bonce the (?:PCs|heroes|party) reach\b/i],
  ['challenge', /\b(skill challenge|Victory Points?|Influence Points?|Research Points?|Chase Points?|Infiltration Points?|Awareness Points?|Edge Points?|obstacles? in the chase)\b/i],
];
function eventPhrase(s) {
  if (/\bread (?:or paraphrase )?(?:the following|aloud)\b/i.test(s)) return null;   // a read-aloud cue, not an event
  for (const [what, re] of EVENT_PHRASES) if (re.test(s)) return what;
  return null;
}
const SUBSYSTEM_HEADS = [
  ['influence', /(^|\n)\s*(INFLUENCE|Influence)\s*(\d+|Skills)\b/],
  ['chase', /(^|\n)\s*(CHASE|Chase) (Points|Obstacle)|\bObstacle Level\b/],
  ['infiltration', /(^|\n)\s*Awareness Points?\b|\bInfiltration\b.*\bObstacles?\b/],
  ['research', /(^|\n)\s*Research Checks?\b|\bResearch Points? \(?(?:RP)?/],
  ['victory-points', /(^|\n)\s*(VICTORY POINTS|Victory Points)\b/],
];

export function areaFacts(text) {
  const t = text.replace(/-\n\s*/g, '').replace(/\s*\n\s*/g, ' ');
  const out = [];
  for (const m of t.matchAll(new RegExp(`DC (\\d+)(?:\\s+((?:${SKILLS})(?:(?:, | or |, or )(?:${SKILLS}))*))?`, 'g'))) {
    out.push({ kind: 'dc', dc: Number(m[1]), what: m[2] || null, at: around(t, m.index) });
  }
  const sentences = t.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    if (/Perception [+-]\d|\bAC \d+;|Speed \d+ feet|\[(one|two|three)-actions?\]|\bHP \d+/.test(s)) continue;   // a stat block's lines
    const door = /\bdoors?\b/i.test(s);
    if (/\bsecret door/i.test(s)) out.push({ kind: 'door', what: 'secret', at: s.slice(0, 90) });
    if (door && /\blocked\b/i.test(s) && !/\bunlocked\b/i.test(s)) out.push({ kind: 'door', what: 'locked', at: s.slice(0, 90) });
    else if (/\blocked\b/i.test(s) && !/\bunlocked\b/i.test(s)) out.push({ kind: 'lock', at: s.slice(0, 90) });
    if (door && /\bstuck\b/i.test(s)) out.push({ kind: 'door', what: 'stuck', at: s.slice(0, 90) });
    if (door && /\b(barred|blocked|barricaded)\b/i.test(s)) out.push({ kind: 'door', what: 'blocked', at: s.slice(0, 90) });
    // the room's light, not an event's: "glows" (something lights up) is left out; "glowing" mushrooms are not
    if (/\b(bright light|brightly lit|well lit|sunlight|daylight)\b/i.test(s) && !/\bglows\b/i.test(s)) out.push({ kind: 'light', level: 'bright', at: s.slice(0, 90) });
    else if (/\b(dim light|dimly lit|faint light|glowing|pale (?:\w+ )?light)\b/i.test(s) && !/\bglows\b/i.test(s)) out.push({ kind: 'light', level: 'dim', at: s.slice(0, 90) });
    else if (/\b(pitch[- ]black|complete darkness|in darkness|is dark|are dark|no light)\b/i.test(s)) out.push({ kind: 'light', level: 'dark', at: s.slice(0, 90) });
    if (/\b(torch(es)?|lanterns?|braziers?|candles?|campfire|a fire|fireplace|hearth)\b/i.test(s)) out.push({ kind: 'light', source: true, at: s.slice(0, 90) });
    if (/\bgreater difficult terrain\b/i.test(s)) out.push({ kind: 'terrain', what: 'greater-difficult', at: s.slice(0, 90) });
    else if (/\bdifficult terrain\b/i.test(s)) out.push({ kind: 'terrain', what: 'difficult', at: s.slice(0, 90) });
    if (/\bhazardous terrain\b/i.test(s)) out.push({ kind: 'terrain', what: 'hazardous', at: s.slice(0, 90) });
    if (/\b(swim|deep water|Swim check)\b/i.test(s)) out.push({ kind: 'terrain', what: 'swim', at: s.slice(0, 90) });
    const ev = eventPhrase(s);
    if (ev) out.push({ kind: 'event', what: ev, at: s.slice(0, 90) });
  }
  // a subsystem's block (its heading words, on a line of their own)
  for (const [what, re] of SUBSYSTEM_HEADS) if (re.test(text)) out.push({ kind: 'event', what, at: what });
  if (/(^|\n)\s*Treasure\b/.test(text)) out.push({ kind: 'treasure', at: 'Treasure' });
  return out;
}

// ---- loot and hazard matching (tools/advimport/lootmatch.mjs, #16) ----

/** A price written after a name in the book, "(5 gp)", "(2 gp, 5 sp)", as {gp, sp, cp}, or null. */
export function priceAfter(text, name) {
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
  const rest = text.slice(at + name.length);
  const gap = /^([^(]*)\(/.exec(rest);   // only a few words may stand between, and never another item ("and a rope")
  if (!gap || gap[1].length > 20 || /[.;,]|\b(and|or|with)\b/.test(gap[1])) return null;
  const m = /^[^(]*\(([^)]*\b(?:gp|sp|cp|pp)\b[^)]*)\)/.exec(rest);
  if (!m) return null;
  const out = {};
  for (const c of m[1].matchAll(/(\d+)\s*(pp|gp|sp|cp)\b/g)) out[c[2]] = (out[c[2]] || 0) + Number(c[1]);
  return Object.keys(out).length ? out : null;
}

/** An item's price in copper, for comparing. */
export const priceCp = (p) => (p ? (p.pp || 0) * 1000 + (p.gp || 0) * 100 + (p.sp || 0) * 10 + (p.cp || 0) : null);

/** The treasure paragraphs of an area's text (after a "Treasure" heading, up to the next heading). */
export function treasureText(text) {
  const lines = text.split('\n'), out = [];
  let on = false;
  for (const l of lines) {
    if (/^\s*Treasure\b/.test(l)) { on = true; continue; }
    if (on && /^\s*([A-Z]{1,2}\d{1,2}[a-z]?[.:]\s|[A-Z][A-Z ,'’-]{6,}$)/.test(l)) on = false;
    if (on) out.push(l);
  }
  return out.join(' ').replace(/\s+/g, ' ');
}

/** A hazard's printed numbers, as the book gives them: {stealth, disable: [dc...], ac, hp}. */
export function hazardNumbers(text) {
  const t = text.replace(/\s+/g, ' ');
  const n = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  const disablePart = (/Disable\b(.{0,240}?)(?:\bAC \d|\bHP \d|Routine|Reset|\bReaction\b|$)/.exec(t) || [])[1] || '';
  return {
    stealth: n(/(?:Stealth|Notice) DC (\d+)/) ?? n(/Stealth \+?(\d+)/),
    disable: [...disablePart.matchAll(/DC (\d+)/g)].map((m) => Number(m[1])),
    ac: n(/\bAC (\d+)/), hp: n(/\bHP (\d+)/),
  };
}

/** The same numbers from an open-content hazard. */
export function hazardContent(doc) {
  const s = doc.stats || {};
  return {
    stealth: s.stealth ? (s.stealth.dc ?? (s.stealth.value !== undefined ? s.stealth.value + 10 : null)) : null,
    stealthMod: s.stealth && s.stealth.value !== undefined ? s.stealth.value : null,
    disable: [...String(doc.disable || '').matchAll(/DC (\d+)/g)].map((m) => Number(m[1])),
    ac: s.ac ?? null, hp: s.hp ?? (s.hitPoints ?? null),
  };
}
