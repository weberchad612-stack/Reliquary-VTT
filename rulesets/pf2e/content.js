// The kinds of PF2E game content (rulesets/pf2e/schemas/content.schema.json) and the folder each is kept in:
// content/<ruleset>/<source>/<folder>/<slug>.json, and a pack's own content/<folder>/<slug>.json. A content key
// is '<folder>/<slug>' (item/longsword, creature/goblin-warrior, spell/fireball, feat/toughness).

/** Physical items, all kept under item/. */
export const ITEM_KINDS = Object.freeze(['armor', 'shield', 'weapon', 'equipment', 'consumable', 'ammo', 'treasure', 'backpack', 'kit']);
/** Every other kind has a folder of its own name. */
export const OWN_KINDS = Object.freeze(['creature', 'hazard', 'vehicle', 'feat', 'action', 'effect', 'condition', 'spell', 'ancestry', 'heritage', 'background', 'class', 'deity', 'campaign-feature', 'trait']);

/** The trait glossary every campaign carries (one board record, built from the traits source). */
export const TRAIT_GLOSSARY_KEY = 'glossary/traits';
export const CONTENT_KINDS = Object.freeze([...OWN_KINDS, ...ITEM_KINDS]);
export const CONTENT_FOLDERS = Object.freeze([...OWN_KINDS, 'item']);

/** The folder a kind of document is kept in ('weapon' -> 'item', 'spell' -> 'spell'); undefined if not a kind. */
export function kindDir(kind) {
  if (ITEM_KINDS.includes(kind)) return 'item';
  return OWN_KINDS.includes(kind) ? kind : undefined;
}
