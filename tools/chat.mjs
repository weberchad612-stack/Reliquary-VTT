#!/usr/bin/env node
// Claude's messages in the board's chat (board/chat.js): narration (read-aloud text), rulings, and an NPC speaking
// (players see its alias until they learn its name). Prints the record to write with db_write; the board shows it
// in the Chat tab, pops it up when the tab is not open, and the save keeps it (chat.json).
//
// Usage: node tools/chat.mjs narration "text" [--gm]
//        node tools/chat.mjs ruling "text" [--gm]
//        node tools/chat.mjs npc <who> "text" --pack <pack-dir> --save <save-dir> [--records FILE] [--gm]
//        node tools/chat.mjs npc --as "Name" [--alias "What players call it"] "text" [--gm]
// --gm makes it the GM's only. <who> is a token's name, alias or id. Docs: docs/best-practices/board.md (chat).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatMessage, chatPath } from '../board/chat.js';
import { resolveToken } from '../board/names.js';

/** The message for a command: {path, data}. game (for npc <who>): {tokens}. */
export function chatPost(kind, args, opts = {}, game = null) {
  if (kind === 'narration' || kind === 'ruling') {
    return { path: chatPath(), data: chatMessage({ kind, by: 'claude', text: args.join(' '), gm: !!opts.gm }) };
  }
  if (kind === 'npc') {
    let token, speaker = opts.as, alias = opts.alias, text = args.join(' ');
    if (!speaker) {
      if (!game) throw new Error('npc <who> needs --pack and --save (or --as "Name")');
      token = resolveToken(game.tokens, args[0]);
      const t = game.tokens[token];
      speaker = t.name; alias = t.alias && !t.known ? t.alias : undefined;
      text = args.slice(1).join(' ');
    }
    return { path: chatPath(), data: chatMessage({ kind: 'npc', by: 'claude', token, speaker, alias, text, gm: !!opts.gm }) };
  }
  throw new Error('kinds: narration, ruling, npc');
}

async function main(argv) {
  const args = argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  try {
    const pack = opt('--pack'), save = opt('--save'), rec = opt('--records'), as = opt('--as'), alias = opt('--alias'), gm = flag('--gm');
    const [kind, ...rest] = args;
    let game = null;
    if (kind === 'npc' && !as) {
      if (!pack || !save) throw new Error('npc <who> needs --pack and --save');
      const { loadGame } = await import('./actor.mjs');
      game = loadGame(pack, save, rec ? JSON.parse(fs.readFileSync(rec, 'utf8')) : null);
    }
    const w = chatPost(kind, rest, { as, alias, gm }, game);
    console.log(JSON.stringify({ op: 'set', path: w.path, data: w.data }, null, 2));
    return 0;
  } catch (e) {
    console.error(`chat: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv).then((c) => process.exit(c));
