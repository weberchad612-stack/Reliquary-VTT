# Reliquary-VTT: notes for Claude

A virtual tabletop framework that Claude uses to run tabletop RPGs. Engine, rulesets and adventure packs are separate; adventure packs are built from books the user owns and stay private.

## Read first

- Best practices for each core feature: [docs/best-practices/](docs/best-practices/README.md). Follow the guide for the feature you are working on.
- Design: [docs/design/maps.md](docs/design/maps.md).
- Future ideas, not yet scheduled: [future/](future/README.md). When an idea comes up and is deferred, write it up there.
- Plan for the whole rebuild: the user's `PF2E_Claude_VTT\future\reimplementation-plan.md` (not in this repo).

## Standing rules

- **Document best practices for every core feature** you build or change, in `docs/best-practices/`, including the lessons learned while doing it.
- **Map importing:** read the adventure text for every keyed area and use the book's labelled map, not only the map image. Where the map explicitly draws something, the drawing wins; the text fills in what the drawing cannot show. Record every decision in the map's `import.json`.
- **Never commit or publish book content.** `pdfsource/`, `extracted/`, `packs/` and `saves/` are private and git-ignored. Check before every commit.
- Run `npm test` and the validator before every commit. Commit to `main`.

## Layout

| Folder | What |
|---|---|
| `engine/` | Walls, doors, sight, fog, movement, terrain, measurement, tokens (dependency-free JavaScript); board page later |
| `schemas/` | JSON schemas for maps, walls, terrain and map state |
| `rulesets/` | Game-system rules the engine asks for (PF2E movement and terrain first) |
| `tools/` | Validator, sight/move/fog query tools, bundler, wall overlay, map importer (`mapimport/`, Python) |
| `examples/` | Original sample pack and save, and the engine demo page |
| `tests/` | `npm test` |
| `future/` | Thought-through ideas not yet scheduled (for example, faster sight); check here before planning new work |
| `packs/`, `saves/`, `pdfsource/` | Private, git-ignored |
