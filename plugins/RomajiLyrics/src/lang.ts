/** Hiragana, katakana, CJK ideographs and half-width katakana */
export const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;

/** Kana only: tells Japanese apart from Chinese (which only uses ideographs) */
export const KANA = /[぀-ヿｦ-ﾟ]/;

/** Hangul syllables + jamo */
export const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;

/** CJK ideographs (kanji / hanzi) */
export const HAN = /[㐀-䶿一-鿿豈-﫿]/;

/** Anything we know how to romanize */
export const ROMANIZABLE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ가-힣ᄀ-ᇿ㄰-㆏]/;

export type Lang = "ja" | "ko" | "zh";

/** Language of a whole song: any kana -> Japanese, else any hangul -> Korean, else any ideograph -> Chinese */
export const detectLang = (text: string): Lang | undefined => {
	if (KANA.test(text)) return "ja";
	if (HANGUL.test(text)) return "ko";
	if (HAN.test(text)) return "zh";
	return undefined;
};

/** Language used for a single line, given the song language (handles e.g. a Korean line in a Japanese song) */
export const lineLang = (line: string, songLang: Lang): Lang | undefined => {
	if (HANGUL.test(line)) return "ko";
	if (KANA.test(line)) return "ja";
	if (HAN.test(line)) return songLang === "ja" ? "ja" : "zh";
	return undefined;
};
