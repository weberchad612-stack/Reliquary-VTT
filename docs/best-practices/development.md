# Best practices: working on the repository

## Every change

- Run `npm test` and `node tools/validate.mjs examples/sample-pack --save examples/sample-save` before committing.
- New behaviour gets tests. When new tests pass on the first run, break the code on purpose once or twice and confirm the tests catch it.
- When a test fails, decide whether the code or the test is wrong before changing either, and say which in the commit or reply.
- Keep the design doc ([docs/design/maps.md](../design/maps.md)) and the matching best-practices guide in step with the code: decisions, measurements, known limits.
- Measure performance on a real map, not only the sample.

## The demo page

- It is one classic script: a top-level function or constant declared twice silently replaces the first (this once broke the GM vision view). `tests/demo.test.mjs` checks for repeats and that every `Engine.<name>` it uses exists.
- One export per declaration in engine and ruleset modules: the bundler only sees the first name of `export const a = 1, b = 2` (it now refuses that form), and `tests/demo.test.mjs` checks every module export reaches the bundled engine. A bug like this passes every Node test and only shows in the page.
- After any change, build it and load it in a headless browser: watch for page errors (a constant used before its definition only fails there), click a token in both views, drag a token, open a door.

## Visual work

- Render the result and look at it: overlays for walls, zoomed tiles with the cell grid for corrections, the demo page for behaviour.
- For pages: one look before publishing, fix what it shows, then publish.

## Privacy and licensing

- Book content (PDFs, images, extracted text, imported packs, demos built on them) never goes into git or a published link. `pdfsource/`, `extracted/`, `packs/` and `saves/` are ignored; check `git status` before every commit.
- Paraphrase adventure text; never copy passages.
- The public repo ships only code, schemas, original sample content and open-licensed rules content: the PF2E rules we write, and game data converted from the Foundry PF2E system's open data (ORC and OGL) in `content/pf2e/`, with the notices in `NOTICE.md` and `licenses/`. Text, maps and art from books never.

## The user's working preferences

- Commit straight to `main` for now.
- When the user asks to take something slowly, ask questions one at a time.
- Report what was done and what was decided; list decisions where the user can review them (for maps, the `decisions` list in `import.json`).
- Anything that runs every frame (the light animation layer) must leave the canvas as it found it: wrap each frame in `save()`/`restore()`. A clip applied per frame without them piles up: the first animation layer slowed from 30 to 5 frames a second within a minute and then seemed to stop. Run a headless check for at least a minute and watch the frame rate, not just the first frames.
