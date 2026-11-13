#!/usr/bin/env node
// A smoke run of the board in headless Chrome: builds the Sample Keep test board and walks the main features, as
// a person would, in both views. Prints one line per check and exits non-zero when one fails or the page logs an
// error. Run it after any board change, before publishing:
//
//   NODE_PATH=$(npm root -g) node tools/headless/smoke.mjs [--keep FILE] [--only name,name]
//
// --keep writes the built board to FILE (to open by hand); --only runs some checks. A failed check leaves a
// screenshot in /tmp/smoke-<check>.png. Docs:
// docs/best-practices/development.md (headless checks).

import { buildTestBoard, openBoard, asGM, asPlayer, openTab, screenAt, screenAtSquare, records, writeRecord } from './board.mjs';

const KERRA = 'tok-cw77vfz9', OGRE = 'tok-sxodpi74', PIP = 'tok-rf053o2i';

const CHECKS = {
  async views({ page }) {
    const tabs = () => page.evaluate(() => [...document.querySelectorAll('.sb-strip [data-tab]')].filter((x) => !x.hidden).map((x) => x.dataset.tab));
    const player = await tabs();
    await asGM(page);
    const gm = await tabs();
    await asPlayer(page);
    return ok(!player.includes('audit') && !player.includes('lighting') && gm.includes('audit') && gm.includes('walls'), `player tabs ${player.length}, GM tabs ${gm.length}`);
  },
  async drag({ page }) {
    const k = await screenAt(page, KERRA);
    await page.mouse.move(...k.at); await page.mouse.down();
    await page.mouse.move(...await screenAtSquare(page, k.x, k.y - 2), { steps: 5 }); await page.keyboard.press('Space');   // a waypoint
    await page.mouse.move(...await screenAtSquare(page, k.x + 2, k.y - 2), { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');   // let go of the selection, so a later Enter does not open Quick-View
    const t = await page.evaluate((id) => window.reliquary.state().tokens[id], KERRA);
    const audit = await records(page, 'audit');
    return ok(t.x === k.x + 2 && t.y === k.y - 2 && audit.some((e) => /Kerra moved \d+ ft/.test(e.data.text)), `Kerra to ${t.x},${t.y}; audit "${(audit.at(-1) || { data: {} }).data.text}"`);
  },
  async notes({ page }) {
    await openTab(page, 'notes');
    await page.click('[data-nt=add]');
    await page.mouse.click(...await screenAtSquare(page, 20, 40));
    await page.waitForSelector('.nedit textarea:focus');   // the editor takes the focus a moment after it opens
    await page.keyboard.type('smoke note'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    await page.hover('.nt-row'); await page.waitForTimeout(150);
    const lit = await page.$$eval('.notes .pin.pointout', (x) => x.length);
    return ok((await records(page, 'notes')).some((n) => n.data.text === 'smoke note') && lit === 1, `note saved, ${lit} pin highlighted`);
  },
  async encounter({ page }) {
    await asGM(page);
    await writeRecord(page, 'state/encounter', { round: 0, turn: null, started: 0, combatants: [{ token: KERRA, side: 'pc', initiative: 20 }, { token: OGRE, side: 'foe', initiative: 15 }] });
    await openTab(page, 'encounter');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.tracker [data-a=begin]').click()); await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.tracker [data-a=next]').click()); await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.tracker .trk-row:nth-child(2) [data-a=defeated]').click()); await page.waitForTimeout(800);
    const chat = (await records(page, 'chat')).map((e) => e.data.text);
    const dead = await page.evaluate((id) => !!window.reliquary.state().tokens[id].dead, OGRE);
    await asPlayer(page);
    return ok(chat.includes('The encounter begins') && chat.includes('Round 1') && dead, `chat events: ${chat.filter(Boolean).join(' | ')}; ogre dead: ${dead}`);
  },
  async dice({ page }) {
    await writeRecord(page, 'dice/0mwe00000-0smoke', { at: new Date().toISOString(), by: 'claude', who: 'Kerra', side: 'party', kind: 'attack', dice: [{ sides: 20, v: 17 }] });
    await openTab(page, 'dice'); await page.waitForTimeout(300);
    const sum = await page.$eval('.dc-sum', (x) => x.textContent).catch(() => '');
    return ok(/\d+ rolls?/.test(sum), sum.slice(0, 40));
  },
  async hidden({ page }) {
    await asGM(page);
    await page.mouse.click(...(await screenAt(page, OGRE)).at, { button: 'right' }); await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('#tokhud-left .hud-btn')].find((b) => /Hide from players/.test(b.title)).click());
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await asPlayer(page);
    const seen = await page.evaluate((id) => !!window.reliquary.state().tokens[id].hidden, OGRE);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.tracker .trk-row .trk-name')].map((n) => n.textContent));
    return ok(seen && !rows.some((r) => /Ogre/.test(r)), `ogre hidden; player tracker rows: ${rows.join(', ') || 'none'}`);
  },
  async boardinfo({ page }) {
    const player = await page.$eval('#dbg', (x) => !x.hidden);
    await asGM(page);
    await page.click('#dbg-t'); await page.waitForTimeout(200);
    const text = await page.$eval('#hud', (x) => x.innerText);
    await page.click('#dbg-t'); await asPlayer(page);
    return ok(!player && /listeners \d+/.test(text), `player sees it: ${player}; GM: ${text.split('\n').length} lines`);
  },
  async listeners({ page }) {
    const n = await page.evaluate(() => window.reliquary.store.listeners());
    return ok(n > 0 && n < 30, `${n} listeners (the platform caps about 40)`);
  },
};

const ok = (pass, detail) => ({ pass: !!pass, detail });

async function main(argv) {
  const timeout = 8000;
  const opt = (k) => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const only = opt('--only') ? opt('--only').split(',') : Object.keys(CHECKS);
  const html = buildTestBoard({ out: opt('--keep') || null });
  const b = await openBoard(html);
  b.page.setDefaultTimeout(timeout);
  let failed = 0;
  try {
    for (const name of only) {
      const t0 = Date.now();
      let r;
      try { r = await CHECKS[name](b); } catch (e) { r = { pass: false, detail: e.message.split('\n')[0] }; }
      if (!r.pass) { failed++; await b.page.screenshot({ path: `/tmp/smoke-${name}.png` }).catch(() => {}); r.detail += ` (screenshot /tmp/smoke-${name}.png)`; }
      console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${r.detail} (${Date.now() - t0} ms)`);
    }
  } finally { await b.close(); }
  if (b.errors.length) { failed++; console.log(`FAIL page errors: ${b.errors.join(' | ')}`); } else console.log('ok   no page errors');
  console.log(failed ? `${failed} failed` : 'all passed');
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
