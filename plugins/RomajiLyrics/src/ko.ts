// Korean -> Revised Romanization, with the common pronunciation rules (liaison, nasalization, ㄹ, aspiration, palatalization)

// Initial consonants (choseong) by index
const L = { G: 0, KK: 1, N: 2, D: 3, R: 5, M: 6, B: 7, S: 9, SS: 10, NG: 11, J: 12, CH: 14, K: 15, T: 16, P: 17, H: 18 } as const;
const INITIALS = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWELS = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const VOWEL_I = 20;

// Final consonants (jongseong) by index: 0 none, 1 ㄱ, 2 ㄲ, 3 ㄳ, 4 ㄴ, 5 ㄵ, 6 ㄶ, 7 ㄷ, 8 ㄹ, 9 ㄺ, 10 ㄻ, 11 ㄼ, 12 ㄽ, 13 ㄾ,
// 14 ㄿ, 15 ㅀ, 16 ㅁ, 17 ㅂ, 18 ㅄ, 19 ㅅ, 20 ㅆ, 21 ㅇ, 22 ㅈ, 23 ㅊ, 24 ㅋ, 25 ㅌ, 26 ㅍ, 27 ㅎ

/** What happens to a final when the next syllable starts with ㅇ: [final left behind, initial moved over] */
const LIAISON: Record<number, [number, number]> = {
	1: [0, L.G],
	2: [0, L.KK],
	3: [1, L.S], // RR doesn't write tensification: 없어 -> eopseo
	4: [0, L.N],
	5: [4, L.J],
	6: [0, L.N],
	7: [0, L.D],
	8: [0, L.R],
	9: [8, L.G],
	10: [8, L.M],
	11: [8, L.B],
	12: [8, L.S],
	13: [8, L.T],
	14: [8, L.P],
	15: [0, L.R],
	16: [0, L.M],
	17: [0, L.B],
	18: [17, L.S],
	19: [0, L.S],
	20: [0, L.SS],
	22: [0, L.J],
	23: [0, L.CH],
	24: [0, L.K],
	25: [0, L.T],
	26: [0, L.P],
	27: [0, L.NG], // ㅎ is silent before a vowel
};

/** Neutralized sound of each final (what you actually hear at the end of a syllable) */
type Sound = "" | "k" | "n" | "t" | "l" | "m" | "p" | "ng";
const FINAL_SOUND: Sound[] = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

const HAS_H = new Set([6, 15, 27]); // ㄶ ㅀ ㅎ
const ASPIRATE: Partial<Record<number, number>> = { [L.G]: L.K, [L.D]: L.T, [L.J]: L.CH, [L.B]: L.P };

type Syllable = { l: number; v: number; t: number; sound: Sound; initial?: string };

const decompose = (ch: string): Syllable => {
	const code = ch.charCodeAt(0) - 0xac00;
	const t = code % 28;
	return { l: Math.floor(code / 588), v: Math.floor((code % 588) / 28), t, sound: FINAL_SOUND[t] };
};

const romanizeWord = (word: string): string => {
	const syl = [...word].map(decompose);

	for (let i = 0; i < syl.length - 1; i++) {
		const cur = syl[i];
		const next = syl[i + 1];

		// Liaison: final consonant moves to an empty (ㅇ) initial
		if (next.l === L.NG && cur.t !== 0 && cur.t !== 21) {
			const [left, moved] = LIAISON[cur.t];
			// Palatalization: ㄷ/ㅌ + 이 -> 지/치 (같이 -> gachi)
			next.l = next.v === VOWEL_I && moved === L.D ? L.J : next.v === VOWEL_I && moved === L.T ? L.CH : moved;
			cur.t = left;
			cur.sound = FINAL_SOUND[left];
			continue;
		}

		// ㅎ final + ㄱ/ㄷ/ㅈ -> aspirated (좋다 -> jota)
		if (HAS_H.has(cur.t) && ASPIRATE[next.l] !== undefined) {
			next.l = ASPIRATE[next.l]!;
			cur.sound = cur.t === 6 ? "n" : cur.t === 15 ? "l" : "";
			continue;
		}
		// ㄱ/ㄷ/ㅂ sound + ㅎ -> aspirated (축하 -> chuka)
		if (next.l === L.H && (cur.sound === "k" || cur.sound === "t" || cur.sound === "p")) {
			next.l = cur.sound === "k" ? L.K : cur.sound === "t" ? L.T : L.P;
			cur.sound = "";
			continue;
		}

		// ㄹ after anything but a vowel/ㄹ/ㄴ becomes ㄴ (종로 -> jongno, 백로 -> baengno)
		if (next.l === L.R) {
			if (cur.sound === "l" || cur.sound === "n") {
				cur.sound = "l";
				next.initial = "l"; // 신라 -> silla, 별로 -> byeollo
				continue;
			}
			if (cur.sound !== "") next.l = L.N;
		}

		// Nasalization before ㄴ/ㅁ (감사합니다 -> gamsahamnida, 국물 -> gungmul)
		if (next.l === L.N || next.l === L.M) {
			if (cur.sound === "k") cur.sound = "ng";
			else if (cur.sound === "t") cur.sound = "n";
			else if (cur.sound === "p") cur.sound = "m";
			else if (cur.sound === "l" && next.l === L.N) next.initial = "l"; // 설날 -> seollal
		}
	}

	return syl.map((s) => (s.initial ?? INITIALS[s.l]) + VOWELS[s.v] + s.sound).join("");
};

/** Converts a line with Korean to romanization. Non Korean text is left untouched. */
export const romanizeKorean = (line: string): string =>
	line.normalize("NFC").replace(/[가-힣]+/g, (word) => romanizeWord(word));
