// Quick check of the romanization outside Tidal: `pnpm run test`
import { createRequire } from "module";
import path from "path";

import kuromoji, { type IpadicFeatures, type Tokenizer } from "kuromoji";

import { romanizeJapanese } from "../src/ja";
import { romanizeKorean } from "../src/ko";
import { romanizeChinese } from "../src/zh";

const require = createRequire(import.meta.url);
const dicPath = path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");

const tokenizer = await new Promise<Tokenizer<IpadicFeatures>>((res, rej) =>
	kuromoji.builder({ dicPath }).build((err, t) => (err ? rej(err) : res(t))),
);

let failed = 0;
const check = (name: string, fn: (s: string) => string, cases: [string, string][]) => {
	console.log(`--- ${name}`);
	for (const [input, expected] of cases) {
		const out = fn(input);
		const ok = out === expected;
		if (!ok) failed++;
		console.log(`${ok ? "OK  " : "FAIL"} ${input} -> ${out}${ok ? "" : `   (esperado: ${expected})`}`);
	}
};

check("japonés", (s) => romanizeJapanese(tokenizer, s), [
	["君の名は", "kimi no na wa"],
	["二人だけの空が広がる夜に", "futari dake no sora ga hirogaru yoru ni"],
	["僕は君を待っている", "boku wa kimi wo matteiru"],
	["言ってしまったんだ", "itteshimatta nda"],
	["君はずるい、ずるい人だ、もう", "kimi wa zurui, zurui hito da, mou"],
	["わがままな君の中で綺麗に腐った罰", "wagamama na kimi no naka de kirei ni kusatta bachi"],
	["「さよなら」なんて言わないで、ずっと一緒に", "“sayonara” nante iwanaide, zutto issho ni"],
	["I love you 愛してる", "I love you aishiteru"],
	["ゲームセンターで遊ぼう", "geemusentaa de asobou"],
]);

check("coreano", romanizeKorean, [
	["사랑해", "saranghae"],
	["감사합니다", "gamsahamnida"],
	["안녕하세요", "annyeonghaseyo"],
	["좋아", "joa"],
	["좋다", "jota"],
	["같이 가요", "gachi gayo"],
	["한국어", "hangugeo"],
	["많이 보고 싶어", "mani bogo sipeo"],
	["국물", "gungmul"],
	["별로", "byeollo"],
	["신라", "silla"],
	["종로", "jongno"],
	["축하해", "chukahae"],
	["없어", "eopseo"],
	["너를 사랑해 forever", "neoreul saranghae forever"],
]);

check("chino", romanizeChinese, [
	["我爱你", "wǒ ài nǐ"],
	["月亮代表我的心", "yuè liàng dài biǎo wǒ de xīn"],
	["你好，世界！", "nǐ hǎo, shì jiè!"],
	["我们一起长大了", "wǒ men yì qǐ zhǎng dà le"],
	["Baby 我想你", "Baby wǒ xiǎng nǐ"],
]);

console.log(failed === 0 ? "\nTodo OK" : `\n${failed} fallos`);
