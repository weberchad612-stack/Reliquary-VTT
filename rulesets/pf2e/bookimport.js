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
