#!/usr/bin/env node
// Every page of a book as text, one file per page (p001.txt ...), with the layout kept (pdftotext -layout), for the
// adventure importer's reading, statmatch and the area checklist (docs/best-practices/adventure-importer.md).
//
// Usage: node tools/advimport/pagetext.mjs <book.pdf> <out-dir>
// Needs poppler's pdftotext and pdfinfo.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function main(argv) {
  const [pdf, out] = argv.slice(2);
  if (!pdf || !out) { console.error('usage: node tools/advimport/pagetext.mjs <book.pdf> <out-dir>'); return 2; }
  const info = spawnSync('pdfinfo', [pdf], { encoding: 'utf8' });
  if (info.status !== 0) { console.error(info.stderr.trim() || 'pdfinfo failed'); return 1; }
  const pages = Number((/Pages:\s+(\d+)/.exec(info.stdout) || [])[1]);
  fs.mkdirSync(out, { recursive: true });
  for (let p = 1; p <= pages; p++) {
    const f = path.join(out, `p${String(p).padStart(3, '0')}.txt`);
    const r = spawnSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdf, f], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(`page ${p}: ${r.stderr.trim()}`); return 1; }
  }
  console.log(`wrote ${pages} pages to ${out}`);
  return 0;
}

process.exitCode = main(process.argv);
