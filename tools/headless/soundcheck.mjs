#!/usr/bin/env node
// A check of the board's sound in headless Chrome, with the real sound files: builds the Sample Keep test board,
// serves it over http next to a sounds folder (sounds.json and the mp3s, as published), and checks that the
// manifest loads, music plays and follows the encounter, a visual effect plays its sound, the soundboard plays on
// every screen, and an ambient source is heard from the selected token and not from far away.
//
//   NODE_PATH=$(npm root -g) node tools/headless/soundcheck.mjs --sounds /home/claude/audio/sounds
//
// Docs: docs/best-practices/sound.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { buildTestBoard, playwright, asGM, writeRecord } from './board.mjs';

const KERRA = 'tok-cw77vfz9', OGRE = 'tok-sxodpi74', PIP = 'tok-rf053o2i';   // Pip has a wall 3 squares to the west
const args = process.argv.slice(2);
const soundsDir = args.includes('--sounds') ? args[args.indexOf('--sounds') + 1] : '/home/claude/audio/sounds';
if (!fs.existsSync(path.join(soundsDir, 'sounds.json'))) { console.error(`no sounds.json in ${soundsDir}`); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundcheck-'));
const html = buildTestBoard({ out: path.join(dir, 'index.html') });
fs.symlinkSync(path.resolve(soundsDir), path.join(dir, 'sounds'));
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const data = fs.readFileSync(p), range = req.headers.range;
  const head = { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (range) {
    const [a, b] = range.replace('bytes=', '').split('-').map((n) => (n ? Number(n) : null));
    const start = a ?? 0, end = b ?? data.length - 1;
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.writeHead(200, { ...head, 'Content-Length': data.length }); res.end(data);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
void html;

const { chromium } = playwright();
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() === 404 && !/favicon/.test(r.url())) errors.push(`404 ${r.url()}`); });
let failed = 0;
const check = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${detail}`); if (!cond) failed++; };
const dbg = () => page.evaluate(() => window.reliquary.sound());
const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (fn(d) || Date.now() - t0 > ms) return d; await page.waitForTimeout(250); } };

try {
  await page.goto(url);
  await page.waitForFunction(() => window.reliquary && window.reliquary.sound && window.reliquary.sound(), null, { timeout: 15000 });
  await page.mouse.click(30, 300);   // the first click lets the page's audio start
  let d = await until((x) => x.running && x.manifest.fx > 0);
  check('manifest', d.running && d.manifest.fx >= 90 && d.manifest.music >= 3, JSON.stringify(d.manifest));
  await asGM(page);
  d = await until((x) => x.music && x.music.t > 1);
  check('music', !!d.music && d.music.t > 1 && !d.music.paused && d.playing.mood === 'explore' && d.rec && d.rec.playing === 'explore', `${d.playing.mood} "${d.playing.piece && d.playing.piece.title}" at ${d.music && d.music.t.toFixed(1)} s; record ${d.rec && d.rec.playing}`);

  await page.evaluate(([a, b]) => window.reliquary.fx.play({ name: 'strike_slash', from: a, to: b, o: { result: 'crit' } }), [KERRA, OGRE]);
  d = await until((x) => x.played.some((p) => p.file.startsWith('fx/strike_slash-crit')));
  check('effect', d.played.some((p) => p.file.startsWith('fx/strike_slash-crit')), d.played.map((p) => p.file).join(', '));

  await writeRecord(page, 'sfx/9999999999999-001', { map: await page.evaluate(() => window.reliquary.map), name: 'sting:victory', by: 'claude', ts: Date.now() });
  d = await until((x) => x.played.some((p) => /sting-victory/.test(p.file)));
  check('sting', d.played.some((p) => /sting-victory/.test(p.file)), d.played.slice(-2).map((p) => p.file).join(', '));

  const k = (await page.evaluate((id) => window.reliquary.state().tokens[id], KERRA));
  await writeRecord(page, 'ambient/amb-campfir1', { map: await page.evaluate(() => window.reliquary.map), sound: 'campfire', at: [k.x + 0.5, k.y + 0.5], radius: 20, when: 'always', by: 'claude' });
  await page.evaluate((id) => window.reliquary.select(id), KERRA);
  d = await until((x) => x.loops.some((l) => l.id === 'amb-campfir1' && l.gain > 0.5), 10000);
  const near = (d.loops.find((l) => l.id === 'amb-campfir1') || {}).gain;
  await page.evaluate((id) => window.reliquary.select(id), OGRE);
  d = await until((x) => { const l = x.loops.find((y) => y.id === 'amb-campfir1'); return l && l.gain < 0.05; }, 10000);
  const far = (d.loops.find((l) => l.id === 'amb-campfir1') || {}).gain;
  check('ambient', near > 0.5 && far < 0.05, `campfire heard from Kerra ${near}, from the ogre ${far} (listener: ${d.listener.why})`);

  // walls that stop sound muffle: a river behind the wall west of Pip, a brazier in the open east of him
  const p = await page.evaluate((id) => window.reliquary.state().tokens[id], PIP), mapId = await page.evaluate(() => window.reliquary.map);
  await writeRecord(page, 'ambient/amb-behindwl', { map: mapId, sound: 'river', at: [p.x + 0.5 - 3, p.y + 0.5], radius: 40, when: 'always', by: 'claude' });
  await writeRecord(page, 'ambient/amb-inopen1', { map: mapId, sound: 'brazier', at: [p.x + 0.5 + 3, p.y + 0.5], radius: 40, when: 'always', by: 'claude' });
  await page.evaluate((id) => window.reliquary.select(id), PIP);
  d = await until((x) => { const a = x.loops.find((l) => l.id === 'amb-behindwl'), b = x.loops.find((l) => l.id === 'amb-inopen1'); return a && b && a.lowpass < 2000 && b.lowpass > 10000 && a.gain > 0; }, 10000);
  const wl = d.loops.find((l) => l.id === 'amb-behindwl') || {}, op = d.loops.find((l) => l.id === 'amb-inopen1') || {};
  check('walls', wl.lowpass < 2000 && op.lowpass > 10000 && wl.gain < op.gain, `behind the wall: gain ${wl.gain}, low-pass ${wl.lowpass} Hz; in the open: gain ${op.gain}, low-pass ${op.lowpass} Hz`);

  await writeRecord(page, 'state/encounter', { round: 1, turn: 0, started: Date.now(), combatants: [{ token: KERRA, side: 'pc', initiative: 20 }, { token: OGRE, side: 'foe', initiative: 15 }] });
  d = await until((x) => x.playing.mood !== 'explore', 8000);
  const want = d.facts.boss ? 'boss' : 'combat';
  d = await until((x) => x.music && x.playing.mood === want && x.rec && x.rec.playing === want && (x.music.file || '').includes(`music/${want}-`), 10000);
  check('mood', d.playing.mood === want && (d.music.file || '').includes(`music/${want}-`), `${d.playing.mood} (${d.playing.why}): ${d.music && d.music.file}`);
  await writeRecord(page, 'state/music', { ...d.rec, mood: 'silence', playing: 'silence', since: Date.now() });
  d = await until((x) => x.playing.mood === 'silence' && !x.music, 6000);
  check('silence', d.playing.mood === 'silence' && !d.music, `mood ${d.playing.mood}, music ${d.music ? d.music.file : 'none'}`);
} catch (e) { check('run', false, e.message); }
check('errors', !errors.length, errors.length ? errors.slice(0, 3).join(' | ') : 'no page errors');
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
