// Chinese -> pinyin with tone marks (pinyin-pro handles polyphonic characters from context: 了 le/liǎo, 长 cháng/zhǎng...)
import { pinyin } from "pinyin-pro";

import { HAN } from "./lang";

const PUNCTUATION: Record<string, string> = {
	"，": ",",
	"。": ".",
	"！": "!",
	"？": "?",
	"、": ",",
	"：": ":",
	"；": ";",
	"…": "...",
	"～": "~",
	"「": "“",
	"」": "”",
	"『": "“",
	"』": "”",
	"《": "“",
	"》": "”",
	"（": "(",
	"）": ")",
	"　": " ",
};

/** Converts a line with Chinese to pinyin. Non Chinese text is left untouched. */
export const romanizeChinese = (line: string): string => {
	if (!HAN.test(line)) return line;
	return pinyin(line, { type: "array", nonZh: "consecutive" })
		.map((part) => [...part].map((c) => PUNCTUATION[c] ?? c).join("").trim())
		.filter((part) => part !== "")
		.join(" ")
		.replace(/\s+([,.!?:;~)\]”])/g, "$1")
		.replace(/([(\[“])\s+/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
};
