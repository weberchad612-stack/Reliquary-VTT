// A small, safe expression language for rule values: numbers, references (@value, @level, @actor.level),
// + - * / with the usual precedence, unary minus, parentheses and the functions min, max, floor, ceil, abs.
// Parsed into a tree and evaluated by walking it: never run as code. Docs: docs/design/game-data.md.

const FUNCS = { min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, round: Math.round };

function tokenize(src) {
  const out = [], s = String(src);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; out.push({ t: 'num', v: Number(s.slice(i, j)) }); i = j; continue; }
    if (c === '@') { let j = i + 1; while (j < s.length && /[A-Za-z0-9_.-]/.test(s[j])) j++; out.push({ t: 'ref', v: s.slice(i + 1, j) }); i = j; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
    if ('+-*/(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`unexpected "${c}" in "${src}"`);
  }
  return out;
}

/** Parse an expression into a tree: {n} | {ref} | {op, a, b} | {neg} | {fn, args}. Throws on bad input. */
export function parseExpr(src) {
  if (typeof src === 'number') return { n: src };
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p], take = (t) => { if (!tk[p] || tk[p].t !== t) throw new Error(`expected "${t}" in "${src}"`); return tk[p++]; };
  function primary() {
    const x = tk[p++];
    if (!x) throw new Error(`unexpected end of "${src}"`);
    if (x.t === 'num') { if (!Number.isFinite(x.v)) throw new Error(`bad number in "${src}"`); return { n: x.v }; }
    if (x.t === 'ref') return { ref: x.v };
    if (x.t === '-') return { neg: primary() };
    if (x.t === '+') return primary();
    if (x.t === '(') { const e = sum(); take(')'); return e; }
    if (x.t === 'id') {
      if (!FUNCS[x.v]) throw new Error(`unknown function "${x.v}" in "${src}"`);
      take('('); const args = [];
      if (peek() && peek().t !== ')') { args.push(sum()); while (peek() && peek().t === ',') { p++; args.push(sum()); } }
      take(')');
      return { fn: x.v, args };
    }
    throw new Error(`unexpected "${x.t}" in "${src}"`);
  }
  function product() { let a = primary(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = tk[p++].t; a = { op, a, b: primary() }; } return a; }
  function sum() { let a = product(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = tk[p++].t; a = { op, a, b: product() }; } return a; }
  const tree = sum();
  if (p !== tk.length) throw new Error(`unexpected "${tk[p].t}" in "${src}"`);
  return tree;
}

/** A reference's value: dotted paths into vars (@value, @level, @actor.level). Unknown: an error. */
function lookup(vars, ref) {
  let v = vars;
  for (const k of ref.split('.')) { if (v === null || v === undefined || !(k in Object(v))) throw new Error(`unknown reference @${ref}`); v = v[k]; }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`@${ref} is not a number`);
  return v;
}

/** Evaluate an expression (a string, a number or a parsed tree) with variables. */
export function evalExpr(e, vars = {}) {
  const t = typeof e === 'object' && e !== null ? e : parseExpr(e);
  if ('n' in t) return t.n;
  if ('ref' in t) return lookup(vars, t.ref);
  if ('neg' in t) return -evalExpr(t.neg, vars);
  if ('fn' in t) return FUNCS[t.fn](...t.args.map((a) => evalExpr(a, vars)));
  const a = evalExpr(t.a, vars), b = evalExpr(t.b, vars);
  if (t.op === '+') return a + b;
  if (t.op === '-') return a - b;
  if (t.op === '*') return a * b;
  if (b === 0) throw new Error('division by zero');
  return a / b;
}

/** The references an expression uses (for checks). */
export function exprRefs(e) {
  const t = typeof e === 'object' && e !== null ? e : parseExpr(e), out = new Set();
  (function walk(x) { if ('ref' in x) out.add(x.ref); if ('neg' in x) walk(x.neg); if ('args' in x) x.args.forEach(walk); if ('a' in x) { walk(x.a); walk(x.b); } })(t);
  return [...out];
}
