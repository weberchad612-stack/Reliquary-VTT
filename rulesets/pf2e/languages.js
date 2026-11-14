// PF2E's languages by rarity (Player Core; the names as Foundry's PF2E system lists them, its rarity setting's
// defaults). Common is every character's; a common language may be learned freely, an uncommon or rare one with
// the GM's leave (docs/design/game-data.md 9.7).

export const LANGUAGES = Object.freeze({
  common: Object.freeze(["common", "draconic", "dwarven", "elven", "fey", "gnomish", "goblin", "halfling", "jotun", "orcish", "sakvroth", "taldane"]),
  uncommon: Object.freeze(["adlet", "aklo", "alghollthu", "amurrun", "arboreal", "boggard", "calda", "caligni", "chthonian", "cyclops", "daemonic", "diabolic", "ekujae", "empyrean", "hallit", "iruxi", "kelish", "kholo", "kibwani", "kitsune", "lirgeni", "muan", "mwangi", "mzunu", "nagaji", "necril", "ocotan", "osiriani", "petran", "protean", "pyric", "requian", "shadowtongue", "shoanti", "skald", "sphinx", "sussuran", "tang", "tengu", "thalassic", "tien", "tripkee", "utopian", "vanara", "varisian", "vudrani", "xanmba", "wayang", "ysoki"]),
  rare: Object.freeze(["akitonian", "anadi", "ancient-osiriani", "androffan", "anugobu", "arcadian", "azlanti", "destrachan", "drooni", "dziriak", "elder-thing", "erutaki", "formian", "garundi", "girtablilu", "goloma", "grioth", "hwan", "iblydan", "ikeshti", "immolis", "jistkan", "jyoti", "kaava", "kashrishi", "kovintal", "lashunta", "mahwek", "migo", "minaten", "minkaian", "munavri", "okaiyan", "orvian", "rasu", "ratajin", "razatlani", "russian", "samsaran", "sasquatch", "senzar", "shae", "shisk", "shobhad", "shoony", "shory", "strix", "surki", "talican", "tanuki", "tekritanin", "thassilonian", "varki", "vishkanyan", "wyrwood", "yaksha", "yithian"]),
  secret: Object.freeze(["wildsong"]),
});

/** A language's rarity, or null when PF2E has no such language. */
export function languageRarity(slug) {
  for (const [r, list] of Object.entries(LANGUAGES)) if (list.includes(slug)) return r;
  return null;
}
