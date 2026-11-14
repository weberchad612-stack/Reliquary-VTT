// The character builder's text check (docs/design/game-data.md 9.13): what a heritage, background or class feature
// says in its text ("You gain the Toughness feat", "You become trained in Stealth", "you learn the Shield cantrip",
// "Choose a skill") against what the builder made of it. The completeness sweep (sweep.js) finds what goes wrong
// with the choices the builder asks; this finds what the text gives that the builder never acted on.

import { autoFill, keysIn } from './sweep.js';
import { SKILLS } from './build.js';
import { ownText } from './textchoices.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// sentences that only describe a condition, a later level or another creature are not the record's own gains
const CONDITIONAL = /(?<!even )\b(if|when|whenever|unless|instead|so long as|as long as|might|may|for the latter|for the former|often|typically|usually|at \d+(?:st|nd|rd|th) level|your (?:companion|familiar|eidolon|ally|allies)|allies|an ally|special)\b/i;

/**
 * The claims a record's text makes, sentence by sentence: [{kind: 'feat'|'skill'|'spell'|'choice', name, text}].
 * Only plain statements ("You gain the Toughness feat"), not conditional ones.
 */
export function textClaims(text) {
  const out = [];
  const t = ownText(text).split(/\n\s*---\s*\n/).pop();   // past a "Power Suit only ---" header
  // a line of a list ("- Autumn: ... you gain the Intimidating Glare skill feat") is one option among several
  const own = t.split('\n').filter((l) => !/^\s*-\s/.test(l) && !/^[A-Z][\w' -]{1,30}:\s/.test(l)).join('\n');
  for (const sen of own.split(/(?<=[.!?])\s+|\n+/)) {
    if (!sen.trim() || CONDITIONAL.test(sen)) continue;
    let m;
    for (m of sen.matchAll(/\b[Yy]ou gain the ([A-Z][\w’' -]+?) (?:general |skill |ancestry |class |\w+ )?feat\b/g)) out.push({ kind: 'feat', name: m[1].trim(), text: sen.trim() });
    if ((m = /\byou (?:become|are) trained in ([^.;]+)/i.exec(sen))) {
      // "your choice of Acrobatics, Crafting, or Performance", "the corresponding Lore": a choice, not each of them
      if (/\b(choice|choose|corresponding|one of)\b/i.test(m[1])) { out.push({ kind: 'choice', name: '', text: sen.trim() }); continue; }
      for (const w of m[1].split(/,|\band\b|\bor\b|\bas well as\b/)) {
        const s = norm(w).replace(/^the /, '').replace(/ skill$/, '');
        if (SKILLS.includes(s)) out.push({ kind: 'skill', name: s, text: sen.trim() });
        else if (/ lore$/.test(s) && !/(of your choice|related|associated|chosen)/.test(s)) out.push({ kind: 'lore', name: s.replace(/ lore$/, ''), text: sen.trim() });
      }
    }
    for (m of sen.matchAll(/\b[Yy]ou (?:learn|gain|can cast) the ([A-Z][\w’' -]+?) (?:[a-z]+ )?(?:spell|cantrip)\b/g)) out.push({ kind: 'spell', name: m[1].trim(), text: sen.trim() });
    if (/\b(choose|of your choice|you select)\b/i.test(sen)) out.push({ kind: 'choice', name: '', text: sen.trim() });
  }
  return out;
}

/**
 * Check one record's claims against a character built with it. built: the derive result; ownChoice: whether the
 * builder asked (or made) a choice for this record. Returns [{kind, text}].
 */
export function checkClaims(doc, built, { ownChoice = false } = {}) {
  const issues = [];
  const actor = built.actor || {};
  const blob = norm(JSON.stringify({ feats: actor.feats, features: actor.features, granted: actor.granted, spells: actor.spellcasting, innate: actor.innate }));
  const P = actor.proficiencies || {};
  for (const c of textClaims(doc.text)) {
    if (c.kind === 'feat' && !blob.includes(norm(c.name))) issues.push({ kind: 'feat not granted', text: `${c.name}: "${c.text.slice(0, 140)}"` });
    else if (c.kind === 'skill' && !((P.skills || {})[c.name] > 0)) issues.push({ kind: 'skill not trained', text: `${c.name}: "${c.text.slice(0, 140)}"` });
    else if (c.kind === 'lore' && !Object.keys(P.lore || {}).some((k) => norm(k) === norm(c.name))) issues.push({ kind: 'lore not trained', text: `${c.name} Lore: "${c.text.slice(0, 140)}"` });
    else if (c.kind === 'spell' && !blob.includes(norm(c.name))) issues.push({ kind: 'spell not granted', text: `${c.name}: "${c.text.slice(0, 140)}"` });
    else if (c.kind === 'choice' && !ownChoice) issues.push({ kind: 'choice not asked', text: `"${c.text.slice(0, 160)}"` });
  }
  return issues;
}

/** Every heritage (on its ancestry) and background, built and checked against its own text. */
export function textCheckOrigins(B, { classKey = 'classes:class/fighter' } = {}) {
  const out = [];
  const run = (where, b, doc, slugs) => {
    const f = autoFill(B, b);
    const r = B.derive(f.build);
    // the builder asked something for the origin: a choice not the class's, its Lore, extra languages
    const cls = B.get(classKey);
    const classOwn = new Set(((cls && cls.features) || []).map((x) => String(x.ref || '').split('/').pop()).concat(classKey.split('/').pop()));
    const own = f.made.some((id) => (/choice\./.test(id) && !classOwn.has(id.replace(/^\d+:choice\./, '').split('.')[0])) || /:(lore|languages)$/.test(id));
    for (const i of checkClaims(doc, r, { ownChoice: own })) out.push({ where, ...i });
  };
  for (const h of keysIn('heritages', 'heritage')) {
    const d = B.get(h);
    if (!d) continue;
    const a = (d.ancestry && d.ancestry.ref) || 'ancestries:ancestry/human';
    run(h, { v: 1, level: 1, ancestry: a, heritage: h, background: 'backgrounds:background/acolyte', class: classKey, approvals: [{ what: a }, { what: h }] }, d, [h.split('/').pop()]);
  }
  for (const g of keysIn('backgrounds', 'background')) {
    const d = B.get(g);
    if (!d) continue;
    run(g, { v: 1, level: 1, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: g, class: classKey, approvals: [{ what: g }] }, d, [g.split('/').pop()]);
  }
  return out;
}

/**
 * A class at a level, built and filled, with every feature it has checked against its own text. Features describe
 * much in passing, so only plain statements count (textClaims); "choice not asked" is left out here, the sweep's
 * job for classes.
 */
export function textCheckClass(B, classKey, { level = 20, fixed = {} } = {}) {
  const out = [];
  const start = { v: 1, level, ancestry: 'ancestries:ancestry/human', heritage: 'heritages:heritage/skilled-human', background: 'backgrounds:background/acolyte', class: classKey, approvals: [{ what: classKey }] };
  const f = autoFill(B, start, { fixed });
  const r = B.derive(f.build);
  for (const feat of r.actor.features || []) {
    const d = feat.ref && B.get(feat.ref);
    if (!d) continue;
    for (const i of checkClaims(d, r, { ownChoice: true })) out.push({ where: d.slug, ...i });
  }
  return out;
}
