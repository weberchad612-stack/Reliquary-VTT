# Open PF2E content

Pathfinder Second Edition game content in our format (`rulesets/pf2e/schemas/content.schema.json`), converted
from the open data of the Pathfinder Second Edition system for Foundry VTT by `tools/import/foundry-pf2e.mjs
--public`. Licences and notices: [NOTICE.md](../../NOTICE.md), [licenses/](../../licenses/).

Layout: `content/pf2e/<source>/<creature|item>/<slug>.json`, one folder per Foundry pack (for example
`pathfinder-monster-core`, `equipment`, `abomination-vaults-bestiary`), with that pack's import report
(`import-report.json`).

Rules for this folder:
- Only documents whose licence is **ORC or OGL** (`source.license`); the importer refuses anything else in
  public mode and the validator checks it.
- Only what Foundry's open data holds: mechanics and the flavour descriptions it carries. Never text, maps or
  art from books (adventure text, keyed rooms): those stay in private packs.
- Don't edit converted documents by hand: fix the importer and convert again, so the folder stays a faithful
  conversion. Additions of our own go in a pack.
