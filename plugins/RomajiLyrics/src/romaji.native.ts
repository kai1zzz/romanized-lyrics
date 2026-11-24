// Runs in Tidal's main (Node) process. Keeps the dictionaries out of the renderer.
import { app } from "electron";
import { access, mkdir, rename, writeFile } from "fs/promises";
import path from "path";

import kuromoji, { type IpadicFeatures, type Tokenizer } from "kuromoji";

import { romanizeJapanese } from "./ja";
import { kanjiLookup } from "./kanji";
import { romanizeKorean } from "./ko";
import { type Lang, lineLang } from "./lang";
import { romanizeChinese } from "./zh";

const KUROMOJI_VERSION = "0.1.2";
const DICT_URL = `https://cdn.jsdelivr.net/npm/kuromoji@${KUROMOJI_VERSION}/dict/`;
const DICT_FILES = [
	"base.dat.gz",
	"cc.dat.gz",
	"check.dat.gz",
	"tid.dat.gz",
	"tid_map.dat.gz",
	"tid_pos.dat.gz",
	"unk.dat.gz",
	"unk_char.dat.gz",
	"unk_compat.dat.gz",
	"unk_invoke.dat.gz",
	"unk_map.dat.gz",
	"unk_pos.dat.gz",
];

const dictDir = () => path.join(app.getPath("userData"), "luna-romaji-lyrics", `kuromoji-dict-${KUROMOJI_VERSION}`);

const exists = (file: string) =>
	access(file).then(
		() => true,
		() => false,
	);

/** Downloads the kuromoji dictionary (~17MB) once and caches it in Tidal's userData folder */
const ensureDictionary = async (): Promise<string> => {
	const dir = dictDir();
	await mkdir(dir, { recursive: true });
	for (const file of DICT_FILES) {
		const target = path.join(dir, file);
		if (await exists(target)) continue;
		const res = await fetch(DICT_URL + file);
		if (!res.ok) throw new Error(`No se pudo descargar ${file}: HTTP ${res.status}`);
		const tmp = `${target}.tmp`;
		await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
		await rename(tmp, target);
	}
	return dir;
};

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | undefined;
const getTokenizer = () => {
	tokenizerPromise ??= ensureDictionary()
		.then(
			(dicPath) =>
				new Promise<Tokenizer<IpadicFeatures>>((resolve, reject) =>
					kuromoji.builder({ dicPath }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer))),
				),
		)
		.catch((err) => {
			// Allow retrying on the next call (e.g. no internet the first time)
			tokenizerPromise = undefined;
			throw err;
		});
	return tokenizerPromise;
};

/** Downloads/loads the Japanese dictionary ahead of time */
export const warmup = async (): Promise<true> => {
	await getTokenizer();
	return true;
};

/** Romanizes each line according to the song language. Lines that can't be romanized are returned unchanged. */
export const romanize = async (lines: string[], songLang: Lang): Promise<string[]> => {
	const langs = lines.map((line) => lineLang(line, songLang));
	const tokenizer = langs.includes("ja") ? await getTokenizer() : undefined;
	return lines.map((line, i) => {
		try {
			switch (langs[i]) {
				case "ja":
					return romanizeJapanese(tokenizer!, line, kanjiLookup);
				case "ko":
					return romanizeKorean(line);
				case "zh":
					return romanizeChinese(line);
				default:
					return line;
			}
		} catch {
			return line;
		}
	});
};
