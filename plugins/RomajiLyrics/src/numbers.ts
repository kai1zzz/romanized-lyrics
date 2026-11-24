// Arabic numerals inside Japanese text, written as they're read (丸1つ -> 丸ひとつ, 1か8か0 -> いちかはちかゼロ).
// Only numbers touching Japanese characters are converted; numbers in English text stay as they are.
// Spelled in katakana so the tokenizer keeps each number as one word (in hiragana it would split いちかはちか).
import { toKatakana } from "wanakana";

const DIGITS = ["ゼロ", "いち", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];
const UNIT_DIGITS = ["", "", "に", "さん", "よん", "ご", "ろく", "なな", "はち", "きゅう"];

/** 0-9999 in hiragana, with the usual sound changes (さんびゃく, はっせん…) */
const readNumber = (n: number): string => {
	if (n === 0) return "ゼロ";
	let out = "";
	const thousands = Math.floor(n / 1000);
	const hundreds = Math.floor((n % 1000) / 100);
	const tens = Math.floor((n % 100) / 10);
	const ones = n % 10;
	if (thousands) out += thousands === 3 ? "さんぜん" : thousands === 8 ? "はっせん" : `${UNIT_DIGITS[thousands]}せん`;
	if (hundreds) out += hundreds === 3 ? "さんびゃく" : hundreds === 6 ? "ろっぴゃく" : hundreds === 8 ? "はっぴゃく" : `${UNIT_DIGITS[hundreds]}ひゃく`;
	if (tens) out += `${UNIT_DIGITS[tens]}じゅう`;
	if (ones) out += DIGITS[ones];
	return out;
};

/** Native counting for 〜つ (ひとつ, ふたつ…) */
const TSU = ["", "ひと", "ふた", "みっ", "よっ", "いつ", "むっ", "なな", "やっ", "ここの"];

const JAPANESE_CHAR = /[぀-ヿ㐀-䶿一-鿿]/;

export const numbersToKana = (text: string): string =>
	text.replace(/\d+/g, (digits, offset: number) => {
		const before = text[offset - 1] ?? "";
		const after = text[offset + digits.length] ?? "";
		if (!JAPANESE_CHAR.test(before) && !JAPANESE_CHAR.test(after)) return digits; // not part of Japanese text
		const n = Number(digits);
		if (after === "つ" && n >= 1 && n <= 9) return TSU[n]; // 1つ -> ひと(つ)
		if (after === "人" && n === 1) return "ひと"; // 1人 -> ひと(り), the 人 is read below
		if (after === "人" && n === 2) return "ふた";
		if (digits.length > 4) return toKatakana([...digits].map((d) => DIGITS[Number(d)]).join("")); // long numbers digit by digit
		return toKatakana(readNumber(n));
	})
		// 一人/二人 counters after the number was spelled out
		.replace(/(ひと|ふた)人/g, "$1り");
