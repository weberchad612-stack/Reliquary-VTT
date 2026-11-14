#!/usr/bin/env node
// Send a private pack (and its campaign save) to the user's PC: what changed since the last sync, checked on arrival,
// never over a file the user changed there (docs/best-practices/adventure-importer.md, section 8).
//
// Usage:
//   node tools/advimport/sync.mjs <pack-dir> [--save <save-dir>] [--out <dir>] [--all] [--pc <md5-list>]
//
// --pc: what the PC has now, as `md5sum` lists it (run in the checkout:
//   find packs/<pack> saves/<pack> -type f ! -path '*/.cache/*' -exec md5sum {} + > _pc-md5.txt
// and stage the file). It replaces the remembered state: only files that differ from the PC's are sent. Use it for
// the first sync of a pack the PC already holds, or when the remembered state is lost.
//
// Writes into <out> (default /mnt/user-data/outputs/sync/<stamp>): the changed files as a .tgz split into parts small
// enough for the device bridge, manifest.json and apply.sh, and prints the steps for Claude:
//   1. device_commit_files: every file in <out> to <checkout>/_sync/<stamp>/ on the PC
//   2. device_bash: bash "<checkout>/_sync/<stamp>/apply.sh" "<checkout>"
// apply.sh joins the parts, checks the archive's md5, and for each file: writes it when the PC's copy is the one
// last synced (or the file is new there; a file never synced before that differs is first copied to
// _to_delete/<stamp>/replaced/); otherwise the PC's copy is kept and the new one goes to
// _sync/<stamp>/incoming/ (a conflict: the user changed it, for instance a save written after play). Files that
// were synced before and are gone from the pack are moved to _to_delete/<stamp>/. Writes overwrite in place
// (deleting is not allowed on the PC). Left out: .cache/, .pipeline-state.json, .sync-state.json, and the art step's
// working candidates (art/candidates/: pdfart.py makes them again; art/book/ holds the chosen art's sources and is
// sent).
// <pack>/.sync-state.json remembers each file's md5 as last sent.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PART = 1900 * 1024;
// left out: caches, run state, and the art step's working candidates (pdfart.py makes them again from the PDFs)
const SKIP = (rel) => /(^|\/)\.cache(\/|$)|\.pipeline-state\.json$|\.sync-state\.json$|\/art\/candidates\//.test(rel);
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), rel = path.relative(REPO, p).split(path.sep).join('/');
    if (SKIP(rel)) continue;
    if (e.isDirectory()) walk(p, base, out); else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** What to send: {send: [{file, md5, prev}], gone: [file], state} from the files now and the state last sent. */
export function plan(files, md5s, last = {}, all = false) {
  last = Object.fromEntries(Object.entries(last).filter(([f]) => !SKIP(f)));   // a file left out is never gone
  const send = files.filter((f) => all || last[f] !== md5s[f]).map((f) => ({ file: f, md5: md5s[f], prev: last[f] || null }));
  const gone = Object.keys(last).filter((f) => !files.includes(f));
  return { send, gone, state: Object.fromEntries(files.map((f) => [f, md5s[f]])) };
}

export const APPLY = `#!/usr/bin/env bash
# Written by tools/advimport/sync.mjs. Usage: bash apply.sh <checkout>
set -u
ROOT="$1"; HERE="$(cd "$(dirname "$0")" && pwd)"; STAMP="$(basename "$HERE")"
cd "$HERE" || exit 1
cat sync.tgz.part* > /tmp/sync-$STAMP.tgz
WANT=$(python3 -c "import json;print(json.load(open('manifest.json'))['md5'])")
GOT=$(md5sum /tmp/sync-$STAMP.tgz | cut -d' ' -f1)
if [ "$WANT" != "$GOT" ]; then echo "BROKEN: the archive arrived damaged ($GOT, expected $WANT)"; exit 1; fi
rm -rf /tmp/sync-$STAMP && mkdir -p /tmp/sync-$STAMP && tar xzf /tmp/sync-$STAMP.tgz -C /tmp/sync-$STAMP || exit 1
python3 - "$ROOT" "$HERE" "$STAMP" <<'PY'
import hashlib, json, os, shutil, sys
root, here, stamp = sys.argv[1:4]
m = json.load(open(os.path.join(here, "manifest.json")))
md5 = lambda f: hashlib.md5(open(f, "rb").read()).hexdigest()
wrote, same, conflicts, moved, backed = 0, 0, [], 0, 0
for e in m["send"]:
    src = os.path.join("/tmp/sync-" + stamp, e["file"]); dst = os.path.join(root, e["file"])
    if os.path.exists(dst):
        have = md5(dst)
        if have == e["md5"]: same += 1; continue
        if e["prev"] is not None and have != e["prev"]:
            inc = os.path.join(here, "incoming", e["file"]); os.makedirs(os.path.dirname(inc), exist_ok=True)
            shutil.copyfile(src, inc); conflicts.append(e["file"]); continue
        if e["prev"] is None:   # never synced before: keep the PC's copy in _to_delete before writing over it
            bak = os.path.join(root, "_to_delete", stamp, "replaced", e["file"]); os.makedirs(os.path.dirname(bak), exist_ok=True)
            shutil.copyfile(dst, bak); backed += 1
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, "rb") as a, open(dst, "wb") as b: shutil.copyfileobj(a, b)   # in place: deleting is not allowed here
    wrote += 1
for f in m["gone"]:
    p = os.path.join(root, f)
    if os.path.exists(p):
        to = os.path.join(root, "_to_delete", stamp, f); os.makedirs(os.path.dirname(to), exist_ok=True); shutil.move(p, to); moved += 1
print(f"synced {m['pack']}: {wrote} written, {same} already the same, {moved} moved to _to_delete/{stamp}, {len(conflicts)} kept (changed on this PC)" + (f", {backed} first-time copies kept in _to_delete/{stamp}/replaced" if backed else ""))
for c in conflicts: print("  KEPT", c, "(the new copy is in _sync/" + stamp + "/incoming)")
PY
mkdir -p "$ROOT/_to_delete" && mv "$HERE" "$ROOT/_to_delete/sync-$STAMP" 2>/dev/null || true
`;

function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const all = args.includes('--all'); if (all) args.splice(args.indexOf('--all'), 1);
  const save = opt('--save');
  const pcList = opt('--pc');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const out = opt('--out') || `/mnt/user-data/outputs/sync/${stamp}`;
  const [packDir] = args;
  if (!packDir) { console.error('usage: node tools/advimport/sync.mjs <pack-dir> [--save <save-dir>] [--out <dir>] [--all]'); return 2; }
  const files = [...walk(path.resolve(packDir)), ...(save ? walk(path.resolve(save)) : [])];
  const md5s = Object.fromEntries(files.map((f) => [f, md5(path.join(REPO, f))]));
  const stateFile = path.join(packDir, '.sync-state.json');
  const last = pcList ? Object.fromEntries(fs.readFileSync(pcList, 'utf8').split('\n').map((l) => /^([0-9a-f]{32})\s+\*?(?:\.\/)?(.+)$/.exec(l.trim())).filter(Boolean).map((m) => [m[2], m[1]]))
    : fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const p = plan(files, md5s, last, all);
  if (!p.send.length && !p.gone.length) { console.log('nothing changed since the last sync'); return 0; }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const tgz = path.join(out, '..', `sync-${stamp}.tgz`);
  const list = path.join(out, '..', `sync-${stamp}.list`);
  fs.writeFileSync(list, p.send.map((e) => e.file).join('\n') + '\n');
  const t = spawnSync('tar', ['czf', tgz, '-C', REPO, '-T', list], { encoding: 'utf8' });
  if (t.status !== 0) { console.error(t.stderr); return 1; }
  const buf = fs.readFileSync(tgz);
  for (let i = 0, n = 0; i < buf.length; i += PART, n++) fs.writeFileSync(path.join(out, `sync.tgz.part${String(n).padStart(2, '0')}`), buf.subarray(i, i + PART));
  fs.rmSync(tgz); fs.rmSync(list);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ pack: path.basename(packDir), stamp, md5: crypto.createHash('md5').update(buf).digest('hex'), send: p.send, gone: p.gone }, null, 1));
  fs.writeFileSync(path.join(out, 'apply.sh'), APPLY);
  // remembered as sent now; a broken transfer is sent again with --all
  fs.writeFileSync(stateFile, JSON.stringify(p.state, null, 0));
  const parts = fs.readdirSync(out).sort();
  console.log(`${p.send.length} file(s) changed, ${p.gone.length} gone; ${(buf.length / 1048576).toFixed(1)} MB in ${parts.length - 2} part(s) in ${out}`);
  console.log('1. device_commit_files, each to <checkout>/_sync/' + stamp + '/<name>:');
  console.log(JSON.stringify(parts.map((f) => ({ stagedPath: path.join(out, f), name: f }))));
  console.log(`2. device_bash: bash "$HOME/mnt/<checkout>/_sync/${stamp}/apply.sh" "$HOME/mnt/<checkout>"`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) process.exitCode = main(process.argv);
