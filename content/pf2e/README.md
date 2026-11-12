# Open PF2E content

All of the open game data of the Pathfinder Second Edition system for Foundry VTT, converted into our format
(`rulesets/pf2e/schemas/content.schema.json`) by `tools/import/foundry-pf2e.mjs --release`. Licences and
notices: [NOTICE.md](../../NOTICE.md), [licenses/](../../licenses/).

Currently Foundry PF2E **8.7.0**: 29,967 documents from 93 Foundry packs (creatures, hazards, vehicles, items,
feats and class features, actions, effects, conditions, spells, ancestries, heritages, backgrounds, classes,
deities, Kingmaker features). What was imported, skipped and not yet supported: [import-report.md](import-report.md).

Layout:

| Path | What |
|---|---|
| `<source>/<folder>/<slug>.json` | One document. `<source>` is the Foundry pack (`pathfinder-monster-core`, `spells`, `abomination-vaults-bestiary`); `<folder>` is `item` for physical items and the kind's own name otherwise (`creature`, `hazard`, `spell`, `feat`...: `rulesets/pf2e/content.js`). Its content key is `<source>:<folder>/<slug>`. |
| `import-manifest.json` | Every document's Foundry id, key and fingerprints, and the release imported: how the next import knows what is new, changed, renamed or gone. |
| `import-report.md`, `import-report.json` | The last import: counts by source, what changed, corrections to review, rules our engine cannot run yet, what was skipped and why. |
| `overrides/<source>/<folder>/<slug>.json` | Our corrections to Foundry data errors, applied after every import (`docs/best-practices/game-data.md` section 4). |

Rules for this folder:
- Only documents whose licence is **ORC or OGL** (`source.license`); the importer refuses anything else and
  the validator checks it (`node tools/validate.mjs --content content/pf2e`).
- Only what Foundry's open data holds: mechanics and the flavour descriptions it carries. Never text, maps or
  art from books (adventure text, keyed rooms): those stay in private packs.
- Don't edit converted documents by hand: correct a data error with an override, improve the converter and
  import again. Additions of our own go in a pack.
- A document Foundry removed is kept, marked `retired`, so saves that use it still load.
