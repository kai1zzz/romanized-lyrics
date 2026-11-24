// Fallback readings for single kanji, from KANJIDIC (via kanji.js, MIT; dictionary data © EDRDG, CC BY-SA 4.0).
// Only used when the morphological dictionary has no reading for a word (rare or literary kanji).
// The package's "main" points to a file it doesn't ship (dist/kanji.min.js), so import the UMD build directly
import Kanji from "kanji.js/dist/kanji.js";

import type { KanjiLookup } from "./ja";

/** Verb dictionary forms end in an u-row kana: dropping it gives the stem (やく -> や, たべる -> たべ) */
const VERB_ENDING = /[うくぐすつぬぶむる]$/;

export const kanjiLookup: KanjiLookup = (kanji, verbStem) => {
	const word = Kanji.getDetails(kanji);
	if (!word) return undefined;
	// KANJIDIC marks prefixes/suffixes with "-": not usable on their own
	const kun = word.kunyomi.filter((r) => !r.includes("-")).map((r) => r.replace(/\./g, ""));
	if (verbStem) {
		const verb = kun.find((r) => VERB_ENDING.test(r) && r.length >= 2);
		if (verb) return verb.slice(0, -1);
	}
	return word.onyomi[0] ?? kun[0];
};
