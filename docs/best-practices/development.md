# Best practices: working on the repository

## Every change

- Run `npm test` and `node tools/validate.mjs examples/sample-pack --save examples/sample-save` before committing.
- New behaviour gets tests. When new tests pass on the first run, break the code on purpose once or twice and confirm the tests catch it.
- When a test fails, decide whether the code or the test is wrong before changing either, and say which in the commit or reply.
- Keep the design doc ([docs/design/maps.md](../design/maps.md)) and the matching best-practices guide in step with the code: decisions, measurements, known limits.
- Measure performance on a real map, not only the sample.

## Visual work

- Render the result and look at it: overlays for walls, zoomed tiles with the cell grid for corrections, the demo page for behaviour.
- For pages: one look before publishing, fix what it shows, then publish.

## Privacy and licensing

- Book content (PDFs, images, extracted text, imported packs, demos built on them) never goes into git or a published link. `pdfsource/`, `extracted/`, `packs/` and `saves/` are ignored; check `git status` before every commit.
- Paraphrase adventure text; never copy passages.
- The public repo ships only code, schemas, original sample content and open-licensed rules content.

## The user's working preferences

- Commit straight to `main` for now.
- When the user asks to take something slowly, ask questions one at a time.
- Report what was done and what was decided; list decisions where the user can review them (for maps, the `decisions` list in `import.json`).
