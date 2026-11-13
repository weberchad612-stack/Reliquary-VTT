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
    return ok(!player.includes('audit') && !player.includes('ledger') && !player.includes('lighting') && player.includes('loot') && gm.includes('audit') && gm.includes('ledger') && gm.includes('walls'), `player tabs ${player.length}, GM tabs ${gm.length}`);
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
    const chat = (await records(page, 'chat')).map((e) => e.data.text).filter(Boolean);
    const audit = (await records(page, 'audit')).map((e) => e.data.text);
    const dead = await page.evaluate((id) => !!window.reliquary.state().tokens[id].dead, OGRE);
    await asPlayer(page);
    // events are the GM's audit log's (the user, 2026-11-12): none in the chat
    return ok(audit.includes('The encounter begins') && audit.includes('Round 1') && !chat.length && dead, `audit: ${audit.slice(-4).join(' | ')}; chat: ${chat.length}; ogre dead: ${dead}`);
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
  async replay({ page }) {
    const now = new Date().toISOString();
    await writeRecord(page, 'state/adjudicating', { by: 'claude', since: now, at: now });
    await page.waitForTimeout(300);
    const banner = await page.$eval('#adj', (x) => !x.hidden && x.textContent.length > 5);
    await page.evaluate(() => window.reliquary.store.remove('state/adjudicating'));
    const pip = await page.evaluate((id) => window.reliquary.state().tokens[id], PIP);
    await writeRecord(page, 'replay/0mwe00000-smok', { title: 'Smoke', by: 'claude', n: 0, revealed: [], narration: ['Pip ducks.'], steps: [
      { side: 'pc', actor: PIP, text: 'Pip steps west', changes: [{ path: `tokens/${PIP}`, to: { x: pip.x - 2 }, from: { x: pip.x } }],
        posts: [{ c: 'chat', data: { by: 'claude', kind: 'ruling', text: 'Pip moves' } }], moves: [{ token: PIP, from: [pip.x, pip.y], to: [pip.x - 2, pip.y] }] }] });
    await page.waitForTimeout(400);
    await page.click('[data-pane=replay] [data-rp=next]');
    await page.waitForTimeout(2500);
    const x = await page.evaluate((id) => window.reliquary.state().tokens[id].x, PIP);
    const chat = (await records(page, 'chat')).map((e) => e.data.text);
    const gone = await page.$eval('#adj', (b) => b.hidden);
    return ok(banner && gone && x === pip.x - 2 && chat.includes('Pip moves') && chat.includes('Pip ducks.'), `banner shown then gone: ${banner}/${gone}; Pip ${pip.x} -> ${x}; chat ${chat.slice(-2).join(' | ')}`);
  },
  async ledger({ page }) {
    await asGM(page);
    await writeRecord(page, 'ledger/0mwe00000-0lgsmk', { at: new Date().toISOString(), by: 'claude', kind: 'thread', title: 'Boot prints', text: 'Prints lead to the west postern.', subjects: ['postern'], status: 'open' });
    await openTab(page, 'ledger'); await page.waitForTimeout(300);
    await page.click('[data-pane=ledger] [data-act=add]');
    await page.selectOption('[data-pane=ledger] select[name=kind]', 'improv');
    await page.fill('[data-pane=ledger] textarea[name=text]', 'The innkeeper is called Brennan.');
    await page.fill('[data-pane=ledger] input[name=subjects]', 'Brennan');
    await page.click('[data-pane=ledger] .lg-save'); await page.waitForTimeout(500);
    const mine = (await records(page, 'ledger')).find((e) => e.data.text === 'The innkeeper is called Brennan.');
    await page.click('[data-pane=ledger] [data-subject=postern]'); await page.waitForTimeout(150);
    const shown = await page.$$eval('[data-pane=ledger] .lg-row', (r) => r.length);
    await page.click('[data-pane=ledger] .lg-row [data-act=close]'); await page.waitForTimeout(500);
    const closed = (await records(page, 'ledger')).find((e) => e.data.title === 'Boot prints').data.status;
    await page.click('[data-pane=ledger] [data-act=story]'); await page.waitForTimeout(150);
    const story = await page.$eval('[data-pane=ledger] .lg-list', (x) => x.textContent);
    await asPlayer(page);
    const playerRows = await page.$$eval('[data-pane=ledger] .lg-row', (r) => r.length);
    return ok(mine && mine.data.by === 'gm' && mine.data.source === 'added' && shown === 1 && closed === 'done' && /The story so far/.test(story) && playerRows === 0,
      `GM entry ${mine ? mine.data.by : 'missing'}; subject filter ${shown} row; thread ${closed}; player rows ${playerRows}`);
  },
  async loot({ page }) {
    // a player takes from the stash and splits the purse; the GM identifies; Bulk puts encumbered on Pip
    await asPlayer(page);
    await writeRecord(page, 'loot/0mwe00000-0idol', { name: 'Silver toad idol', price: { cp: 2500 }, bulk: 1, identified: false, mystery: 'A strange idol', text: 'Cursed.' });
    await writeRecord(page, 'loot/0mwe00001-0dagg', { ref: 'item/dagger', qty: 2 });
    await writeRecord(page, 'loot/0mwe00002-0anvl', { name: 'Anvil', bulk: 9 });
    await writeRecord(page, 'state/purse', { gp: 10, sp: 5 });
    await openTab(page, 'loot'); await page.waitForTimeout(400);
    const playerSees = await page.$eval('[data-pane=loot] .lt-stash', (x) => x.textContent);
    const idolRow = '[data-pane=loot] .lt-row[data-id="0mwe00000-0idol"]';
    await page.click(`${idolRow} [data-act=open]`); await page.waitForTimeout(150);
    const playerDetails = await page.$eval(`${idolRow} .lt-details`, (x) => x.textContent);
    await page.click('[data-pane=loot] .lt-chip[data-group=weapon]'); await page.waitForTimeout(150);
    const weaponsOnly = await page.$$eval('[data-pane=loot] .lt-stash .lt-row', (r) => r.map((x) => x.dataset.id));
    await page.click('[data-pane=loot] .lt-chip[data-group=""]'); await page.waitForTimeout(150);
    const daggerRow = '[data-pane=loot] .lt-row[data-id="0mwe00001-0dagg"]';
    await page.selectOption(`${daggerRow} [data-f=to]`, KERRA);
    await page.click(`${daggerRow} [data-act=take]`); await page.waitForTimeout(400);
    const kerraItems = (await records(page, 'actors')).find((e) => e.id === KERRA).data.items;
    await page.click('[data-pane=loot] [data-act=split]'); await page.waitForTimeout(400);
    const purse = (await records(page, 'state')).find((e) => e.id === 'purse').data;
    const pipCoins = ((await records(page, 'actorstate')).find((e) => e.id === PIP) || { data: {} }).data.coins;
    const anvilRow = '[data-pane=loot] .lt-row[data-id="0mwe00002-0anvl"]';
    await page.selectOption(`${anvilRow} [data-f=to]`, PIP);
    await page.click(`${anvilRow} [data-act=take]`); await page.waitForTimeout(600);
    const pipEnc = await page.evaluate((id) => (window.reliquary.state().tokens[id].effects || []).some((e) => e.id === 'encumbered'), PIP);
    const bar = await page.$eval(`[data-pane=loot] .lt-pc[data-pc="${PIP}"] .lt-bar`, (x) => x.className);
    await asGM(page); await page.waitForTimeout(300);
    const gmSees = await page.$eval('[data-pane=loot] .lt-stash', (x) => x.textContent);
    const gmDetails = await page.$eval(`${idolRow} .lt-details`, (x) => x.textContent);
    await page.click('[data-pane=loot] .lt-row[data-id="0mwe00000-0idol"] [data-act=identify]'); await page.waitForTimeout(400);
    const idol = (await records(page, 'loot')).find((e) => e.id === '0mwe00000-0idol').data;
    // Pip puts the anvil back: the condition goes
    const pipCard = `[data-pane=loot] .lt-pc[data-pc="${PIP}"]`;
    const i = await page.$$eval(`${pipCard} .lt-item`, (li) => li.findIndex((x) => /Anvil/.test(x.textContent)));
    await page.click(`${pipCard} .lt-item:nth-child(${i + 1}) [data-act=putback]`); await page.waitForTimeout(600);
    const pipAfter = await page.evaluate((id) => (window.reliquary.state().tokens[id].effects || []).some((e) => e.id === 'encumbered'), PIP);
    const audit = (await records(page, 'audit')).map((e) => e.data.text).filter((t) => /^loot:/.test(t));
    const pass = /A strange idol/.test(playerSees) && !/Silver toad/.test(playerSees) && /Silver toad idol/.test(gmSees)
      && kerraItems.filter((it) => it.ref === 'item/dagger').length === 1 && kerraItems.find((it) => it.ref === 'item/dagger').qty === 2 && purse.gp === 0 && purse.sp === 0 && pipCoins && pipCoins.gp === 3 && pipCoins.sp === 5
      && pipEnc && /lt-over|lt-enc/.test(bar) && idol.identified === true && !pipAfter && audit.length >= 4
      && /Not identified/.test(playerDetails) && !/Cursed/.test(playerDetails) && /Cursed/.test(gmDetails) && /Identify/.test(gmDetails)
      && weaponsOnly.length === 1 && weaponsOnly[0] === '0mwe00001-0dagg';
    return ok(pass, `player sees idol as stranger: ${/A strange idol/.test(playerSees)}; Kerra took a dagger: ${kerraItems.length}; purse ${JSON.stringify(purse)}, Pip ${JSON.stringify(pipCoins)}; Pip encumbered ${pipEnc} (${bar}) then ${pipAfter}; idol identified ${idol.identified}; ${audit.length} audit lines; details player "${playerDetails.slice(0, 40)}", GM "${gmDetails.slice(0, 40)}"; weapons filter ${weaponsOnly.join(',')}`);
  },
  async exploration({ page }) {
    // players set activities; the pace follows; the GM travels (the clock moves on); combat start applies them
    const LYRA = 'tok-s85mkapz';
    await asPlayer(page);
    await writeRecord(page, 'state/clock', { now: 149136906012, start: 149136904200 });
    await writeRecord(page, 'state/encounter', { round: 0, turn: null, started: 0, ended: 1, combatants: [] });
    await openTab(page, 'exploration'); await page.waitForTimeout(800);
    const pick = async (id, v) => { await page.selectOption(`[data-pane=exploration] .ex-pc[data-pc="${id}"] [data-f=activity]`, v); await page.waitForTimeout(400); };
    await pick(KERRA, 'defend'); await pick(PIP, 'avoid-notice'); await pick(LYRA, 'scout');
    const ex = Object.fromEntries((await records(page, 'explore')).map((e) => [e.id, e.data.activity]));
    const pace = await page.$eval('[data-pane=exploration] .ex-pacebox', (x) => x.textContent);
    const badge = await page.evaluate(() => [...document.querySelectorAll('#tokhud, body')].length);   // the page is up
    await asGM(page); await page.waitForTimeout(400);
    const rem = await page.$eval('[data-pane=exploration] .ex-rem', (x) => x.textContent);
    await page.fill('[data-pane=exploration] .ex-tform input[name=v]', '600');
    await page.click('[data-pane=exploration] .ex-tform button'); await page.waitForTimeout(800);
    const clock = (await records(page, 'state')).find((e) => e.id === 'clock').data.now;
    // combat: Roll All, then Begin
    await writeRecord(page, 'state/encounter', { round: 0, turn: null, started: 0, combatants: [{ token: KERRA, side: 'pc', initiative: null }, { token: PIP, side: 'pc', initiative: null }, { token: OGRE, side: 'foe', initiative: 40 }] });
    await openTab(page, 'encounter'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('.tracker [data-a=roll-all]').click()); await page.waitForTimeout(1500);
    const cards = (await records(page, 'chat')).filter((e) => e.data.kind === 'roll' && e.data.check === 'initiative').map((e) => e.data);
    const pipCard = cards.filter((c) => c.token === PIP).pop(), kerraCard = cards.filter((c) => c.token === KERRA).pop();
    await page.evaluate(() => document.querySelector('.tracker [data-a=begin]').click()); await page.waitForTimeout(1200);
    const shield = ((await records(page, 'actorstate')).find((e) => e.id === KERRA) || { data: {} }).data.shieldRaised;
    const audit = (await records(page, 'audit')).map((e) => e.data.text);
    await page.evaluate(() => { const b = document.querySelector('.tracker [data-a=end]'); if (b) b.click(); }); await page.waitForTimeout(300);
    await asPlayer(page);
    const pass = ex[KERRA] === 'defend' && ex[PIP] === 'avoid-notice' && ex[LYRA] === 'scout' && /half speed/.test(pace) && /125 ft/.test(pace) && /Avoiding Notice/.test(rem)
      && clock === 149136906012 + 288 && pipCard && pipCard.stat.slug === 'stealth' && JSON.stringify(pipCard).includes('Scout') && kerraCard && JSON.stringify(kerraCard).includes('Scout')
      && (shield === true || audit.some((t) => /Kerra's shield is lowered/.test(t))) && audit.some((t) => /party travels 600 feet/.test(t)) && audit.some((t) => /Defend: Kerra/.test(t)) && badge;
    return ok(pass, `choices ${JSON.stringify(ex)}; pace "${pace.slice(0, 60)}"; clock +${clock - 149136906012}s; Pip rolled ${pipCard && pipCard.stat.slug}; Scout on cards ${!!(pipCard && JSON.stringify(pipCard).includes('Scout'))}; Kerra's shield ${shield} (lowered at her turn if she acts first)`);
  },
  async sound({ page }) {
    await asGM(page);
    await openTab(page, 'sound');
    const map = await page.evaluate(() => window.reliquary.map);
    await writeRecord(page, 'ambient/amb-smoke001', { map, sound: 'campfire', at: [20, 40], radius: 20, when: 'always', by: 'claude' });
    await page.waitForTimeout(300);
    await page.click('[data-pane=sound] [data-mood=combat]'); await page.waitForTimeout(300);
    await page.click('[data-pane=sound] [data-play="sting:victory"]'); await page.waitForTimeout(300);
    await page.click('[data-pane=sound] [data-id=amb-smoke001] [data-a=amute]'); await page.waitForTimeout(400);
    const music = (await records(page, 'state')).find((e) => e.id === 'music');
    const sfx = await records(page, 'sfx'), amb = (await records(page, 'ambient')).find((e) => e.id === 'amb-smoke001');
    const sliders = await page.$$eval('[data-pane=sound] [data-vol]', (x) => x.length);
    await asPlayer(page);
    const playerMoods = await page.$$eval('[data-pane=sound] [data-mood]', (x) => x.length);
    return ok(music && music.data.mood === 'combat' && sfx.some((e) => e.data.name === 'sting:victory') && amb && amb.data.off === true && sliders === 5 && playerMoods === 0,
      `music ${music && music.data.mood}; sfx ${sfx.map((e) => e.data.name).join(',')}; ambient off ${amb && amb.data.off}; ${sliders} sliders; player mood buttons ${playerMoods}`);
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
