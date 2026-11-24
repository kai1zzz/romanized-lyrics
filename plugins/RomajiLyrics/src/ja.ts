import type { IpadicFeatures, Tokenizer } from "kuromoji";
import { toRomaji } from "wanakana";

import { JAPANESE } from "./lang";

// Particles that are pronounced differently from how they are written
const PARTICLE_READINGS: Record<string, string> = { は: "wa", へ: "e", を: "wo" };

// Japanese punctuation -> ASCII
const PUNCTUATION: Record<string, string> = {
	"、": ",",
	"。": ".",
	"！": "!",
	"？": "?",
	"・": " ",
	"…": "...",
	"‥": "..",
	"〜": "~",
	"～": "~",
	"「": "“",
	"」": "”",
	"『": "“",
	"』": "”",
	"（": "(",
	"）": ")",
	"【": "[",
	"】": "]",
	"　": " ",
};

/**
 * Readings the IPADIC dictionary gets wrong (or picks the uncommon one) in song lyrics.
 * Applied to the text before tokenizing. Longest keys first.
 */
const READING_OVERRIDES: [string, string][] = [
	["二人", "ふたり"],
	["一人", "ひとり"],
	["大人", "おとな"],
	["今日", "きょう"],
	["明日", "あした"],
	["昨日", "きのう"],
	// In katakana so the tokenizer keeps it as one word (in hiragana it splits it into さま + よう)
	["彷徨う", "サマヨウ"],
	["彷徨い", "サマヨイ"],
	["彷徨っ", "サマヨッ"],
	["彷徨わ", "サマヨワ"],
	["彷徨え", "サマヨエ"],
	["愛して", "あいして"],
	["愛し", "あいし"],
	["愛す", "あいす"],
	["愛さ", "あいさ"],
	["愛せ", "あいせ"],
];

const endsWithSokuon = (s: string) => /[っッ]$/.test(s);

/** Tokens that are glued to the previous word instead of being separated by a space */
const attachesToPrevious = (token: IpadicFeatures, prev: IpadicFeatures | undefined, prevReading: string): boolean => {
	if (prev === undefined) return false;
	if (endsWithSokuon(prevReading)) return true; // 言っ|て -> itte
	// ます, た, ない... glue to verbs/adjectives/other auxiliaries, but not to nouns: 人だ -> hito da, わがままな -> wagamama na
	if (token.pos === "助動詞") {
		if (["動詞", "形容詞", "助動詞"].includes(prev.pos)) return true;
		if (prev.pos === "名詞" && prev.pos_detail_1 === "非自立" && prev.surface_form === "ん") return true; // んだ -> nda
		return false;
	}
	if (token.pos === "動詞" && (token.pos_detail_1 === "接尾" || token.pos_detail_1 === "非自立")) return true; // てる, しまう...
	if (token.pos === "形容詞" && token.pos_detail_1 === "非自立") return true; // ～にくい, ～やすい
	if (token.pos === "助詞" && token.pos_detail_1 === "接続助詞" && ["動詞", "形容詞", "助動詞"].includes(prev.pos)) return true; // て, ば
	return false;
};

/**
 * Reading of a single kanji when the dictionary has none for it in context.
 * `verbStem`: the kanji is followed by a verb ending (灼った), so a kun'yomi stem fits better than the on'yomi.
 */
export type KanjiLookup = (kanji: string, verbStem: boolean) => string | undefined;

const KANJI = /[㐀-䶿一-鿿豈-﫿]/;

const readingOf = (token: IpadicFeatures, next: IpadicFeatures | undefined, lookup?: KanjiLookup): string => {
	const surface = token.surface_form;
	if (token.pos === "助詞" && PARTICLE_READINGS[surface]) return PARTICLE_READINGS[surface];
	if (token.reading && token.reading !== "*") return token.reading;
	// Unknown word with kanji (rare/literary kanji like 灼): read it character by character instead of leaving kanji
	if (lookup && KANJI.test(surface)) {
		const verbStem = next !== undefined && (next.pos === "動詞" || next.pos === "助動詞" || /^[っッ]/.test(next.surface_form));
		return [...surface].map((c) => (KANJI.test(c) ? (lookup(c, verbStem) ?? c) : c)).join("");
	}
	return surface;
};

const kanaToRomaji = (kana: string): string =>
	toRomaji(kana)
		// ー is converted to "-" by wanakana, turn it into a long vowel instead (ゲーム -> geemu)
		.replace(/([aeiou])-/g, "$1$1")
		.replace(/-/g, "");

/** Converts a single line of Japanese text to romaji. Non Japanese text is left untouched. */
export const romanizeJapanese = (tokenizer: Tokenizer<IpadicFeatures>, line: string, lookup?: KanjiLookup): string => {
	if (!JAPANESE.test(line)) return line;

	let text = line.normalize("NFKC");
	for (const [kanji, kana] of READING_OVERRIDES) text = text.replaceAll(kanji, kana);
	const tokens = tokenizer.tokenize(text);

	// Group tokens into "words" so that suffixes/auxiliaries attach to their stem
	const words: string[] = [];
	let current = "";
	let prev: IpadicFeatures | undefined;
	let prevReading = "";

	const flush = () => {
		if (current !== "") words.push(current);
		current = "";
	};

	for (const [i, token] of tokens.entries()) {
		const surface = token.surface_form;

		// Whitespace: word boundary
		if (/^\s+$/.test(surface)) {
			flush();
			prev = undefined;
			prevReading = "";
			continue;
		}

		// Punctuation / symbols
		if (token.pos === "記号" || PUNCTUATION[surface] !== undefined) {
			const mapped = [...surface].map((c) => PUNCTUATION[c] ?? c).join("");
			flush();
			words.push(mapped);
			prev = undefined;
			prevReading = "";
			continue;
		}

		// Kana readings are converted to romaji once the whole word is grouped (so っ+て -> tte works)
		const reading = readingOf(token, tokens[i + 1], lookup);

		if (!attachesToPrevious(token, prev, prevReading)) flush();
		current += reading;
		prev = token;
		prevReading = reading;
	}
	flush();

	return (
		words
			.map((w) => (JAPANESE.test(w) ? kanaToRomaji(w) : w))
			.join(" ")
			// No space before closing punctuation, none after opening brackets/quotes
			.replace(/\s+([,.!?~)\]”])/g, "$1")
			.replace(/([(\[“])\s+/g, "$1")
			.replace(/\s+/g, " ")
			.trim()
	);
};
