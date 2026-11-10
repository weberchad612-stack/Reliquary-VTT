#!/usr/bin/env node
// Bundle engine ES modules into one script for single-file pages (the board, demos).
//
// Usage:
//   node tools/bundle.mjs <template.html> <out.html> [--data NAME=FILE ...]
//
// In the template:
//   /*@ENGINE@*/      is replaced by the bundled engine; it defines `const Engine = {...every export}`.
//   /*@DATA:NAME@*/   is replaced by the JSON or data URL built from --data NAME=FILE.
//                     FILE ending in .json is inlined as JSON; .png/.jpg/.webp become a data URL string;
//                     a map folder (containing map.json) becomes {map, segs, image}.
//
// Each module is wrapped in its own function scope, so module-private names never collide.
// Only the import and export forms the engine uses are supported: named imports with optional
// `as`, and `export const|let|function|class NAME`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'engine');
const ENTRIES = ['walls/presets.js', 'doors/leaf.js', 'terrain/terrain.js', 'measure/measure.js', '../rulesets/pf2e/terrain.js', 'sight/visibility.js', 'movement/movement.js', 'fog/explored.js', 'fog/view.js', 'tokens/tiny.js', 'tokens/occupancy.js', 'tokens/display.js'];

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/** Resolve modules depth-first so every module comes after its imports. */
export function bundleEngine(entries = ENTRIES) {
  const order = [];
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) visit(path.resolve(path.dirname(file), m[2]));
    order.push(file);
  };
  entries.forEach((e) => visit(path.join(ENGINE, e)));

  const id = (file) => '__m_' + path.relative(ENGINE, file).replace(/[^A-Za-z0-9]/g, '_');
  const parts = [];
  const all = [];
  for (const file of order) {
    let src = fs.readFileSync(file, 'utf8');
    src = src.replace(IMPORT_RE, (_, names, from) => {
      const target = id(path.resolve(path.dirname(file), from));
      const list = names.split(',').map((n) => n.trim()).filter(Boolean)
        .map((n) => { const [a, b] = n.split(/\s+as\s+/); return b ? `${a}: ${b}` : a; });
      return `const { ${list.join(', ')} } = ${target};`;
    });
    const names = [...src.matchAll(EXPORT_RE)].map((m) => m[2]);
    src = src.replace(/^export\s+/gm, '');
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`unsupported import/export form in ${file}`);
    parts.push(`// ---- ${path.relative(ROOT, file)} ----\nconst ${id(file)} = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();`);
    all.push(id(file));
  }
  parts.push(`const Engine = Object.freeze(Object.assign({}, ${all.join(', ')}));`);
  return parts.join('\n\n');
}

function dataFor(file) {
  const abs = path.resolve(file);
  if (fs.statSync(abs).isDirectory()) {
    const map = JSON.parse(fs.readFileSync(path.join(abs, 'map.json'), 'utf8'));
    const files = Array.isArray(map.walls) ? map.walls : [map.walls];
    const segs = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8')).segs);
    const image = dataUrl(path.join(abs, map.image.file));
    const terrain = map.terrain ? JSON.parse(fs.readFileSync(path.join(abs, map.terrain), 'utf8')).areas : [];
    return JSON.stringify({ map, segs, image, terrain });
  }
  if (abs.endsWith('.json')) return JSON.stringify(JSON.parse(fs.readFileSync(abs, 'utf8')));
  return JSON.stringify(dataUrl(abs));
}

function dataUrl(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
  if (!mime) throw new Error(`cannot inline ${file}`);
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function main(argv) {
  const args = argv.slice(2);
  const data = {};
  for (let i = args.indexOf('--data'); i >= 0; i = args.indexOf('--data')) {
    const [name, file] = String(args[i + 1]).split('=');
    data[name] = file;
    args.splice(i, 2);
  }
  if (args.length !== 2) {
    console.error('Usage: node tools/bundle.mjs <template.html> <out.html> [--data NAME=FILE ...]');
    return 2;
  }
  let html = fs.readFileSync(args[0], 'utf8');
  html = html.replace('/*@ENGINE@*/', () => bundleEngine());
  html = html.replace(/\/\*@DATA:([A-Za-z0-9_]+)@\*\//g, (_, name) => {
    if (!data[name]) throw new Error(`template needs --data ${name}=FILE`);
    return dataFor(data[name]);
  });
  fs.mkdirSync(path.dirname(path.resolve(args[1])), { recursive: true });
  fs.writeFileSync(args[1], html);
  console.log(`wrote ${args[1]} (${(html.length / 1024).toFixed(0)} KiB)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
