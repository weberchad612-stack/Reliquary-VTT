// Headless checks of the board in a real browser (Playwright and Chrome): build a test board from a campaign, open
// it, switch views, find tokens on screen, collect page errors. Use it to check every board change the way a person
// would (docs/best-practices/development.md). Not part of `npm test`: it needs a browser.
//
//   import { buildTestBoard, openBoard } from './tools/headless/board.mjs';
//   const html = buildTestBoard();                       // the Sample Keep test campaign, with the trait glossaries
//   const { page, close, errors } = await openBoard(html);
//   await asGM(page); const [x, y] = await screenAt(page, tokenId);
//
// Playwright is found as installed for the project or globally (NODE_PATH=$(npm root -g)); Chrome at
// /usr/bin/google-chrome unless CHROME is set.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

/** Playwright, from the project or from the global modules (NODE_PATH). */
export function playwright() {
  try { return require('playwright'); } catch { /* try the global modules */ }
  const g = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return createRequire(path.join(g, 'x.js'))('playwright');
}

/**
 * Build a test board: the board page with a campaign seeded into its in-page database and the trait glossaries.
 * Returns the HTML file's path. pack, save: the campaign (default the Sample Keep test campaign).
 */
export function buildTestBoard({ pack = 'examples/sample-pack', save = 'examples/campaigns/keep-test', out = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
  const seed = path.join(dir, 'seed.json'), glos = path.join(dir, 'glossaries.json'), html = out || path.join(dir, 'board.html');
  const node = (args) => execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe' });
  node(['tools/campaign.mjs', 'seed', pack, save, '--out', seed]);
  node(['tools/campaign.mjs', 'glossaries', '--out', glos]);
  node(['tools/bundle.mjs', 'board/index.html', html, '--data', `seed=${seed}`, '--data', `glossaries=${glos}`]);
  return html;
}

/**
 * Open a board file in headless Chrome: {browser, page, errors, close}. errors collects page errors and console
 * errors as they happen. opts: {width, height, reducedMotion: 'reduce' | 'no-preference'}.
 */
export async function openBoard(html, { width = 1500, height = 950, reducedMotion = 'no-preference' } = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(html));
  await page.waitForFunction(() => window.reliquary && window.reliquary.state, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  return { browser, page, errors, close: () => browser.close() };
}

/** Switch to the GM view (answering its confirmation), or back to the player view. */
export async function asGM(page) {
  await page.click('#v-gm');
  const yes = await page.waitForSelector('#gm-confirm [data-a=yes]', { timeout: 2000 }).catch(() => null);
  if (yes) await yes.click();
  await page.waitForTimeout(300);
}
export async function asPlayer(page) { await page.click('#v-player'); await page.waitForTimeout(300); }

/** Open a sidebar tab by id ('chat', 'encounter', 'notes', 'dice', 'audit'...). */
export async function openTab(page, id) { await page.click(`.sb-strip [data-tab=${id}]`); await page.waitForTimeout(200); }

/** The screen point of a map square's centre (x, y in squares), at the board's current zoom. */
export function screenAtSquare(page, x, y) {
  return page.evaluate(([x, y]) => window.reliquary.screenOf(x + 0.5, y + 0.5), [x, y]);
}

/** The screen point of a token's square, and its square: {x, y, at: [px, py]}. */
export async function screenAt(page, tokenId) {
  const t = await page.evaluate((id) => { const t = window.reliquary.state().tokens[id]; return t && { x: t.x, y: t.y }; }, tokenId);
  if (!t) throw new Error(`no token ${tokenId} on this map`);
  return { ...t, at: await screenAtSquare(page, t.x, t.y) };
}

/** Records of a collection in the board's database: [{id, data}]. */
export const records = (page, collection) => page.evaluate(async (c) => (await window.reliquary.store.list(c)).map((e) => ({ id: e.id, data: e.data })), collection);
/** Write a record into the board's database (as Claude would). */
export const writeRecord = (page, p, data) => page.evaluate(async ([p, d]) => window.reliquary.store.set(p, d), [p, data]);
