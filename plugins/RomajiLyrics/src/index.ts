import { type LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState, type redux, StyleTag } from "@luna/lib";

import { detectLang, type Lang, ROMANIZABLE } from "./lang";
import { setForceMotion } from "./motion.native";
import { romanize, warmup } from "./romaji.native";
import { settings } from "./Settings";

export const { trace, errSignal } = Tracer("[RomajiLyrics]");
export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

type Lyrics = redux.Lyrics;

/** LRC line: one or more [mm:ss.xx] tags followed by the text */
const LRC_LINE = /^((?:\[[^\]]*\])+)(\s*)(.*)$/;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const textLines = (l: Lyrics): string[] => {
	const lines = (l.lyrics ?? "").split(/\r?\n/);
	for (const line of (l.subtitles ?? "").split(/\r?\n/)) lines.push(LRC_LINE.exec(line)?.[3] ?? line);
	return lines;
};

/** original line (normalized) -> romanized, per track */
const conversions = new Map<string, Promise<Map<string, string>>>();
const convert = (l: Lyrics, lang: Lang): Promise<Map<string, string>> => {
	const key = `${l.trackId}:${l.lyrics?.length ?? 0}:${l.subtitles?.length ?? 0}`;
	let conversion = conversions.get(key);
	if (conversion === undefined) {
		conversion = (async () => {
			const unique = [...new Set(textLines(l).map(norm).filter((line) => ROMANIZABLE.test(line)))];
			const romaji = await romanize(unique, lang);
			return new Map(unique.map((line, i) => [line, romaji[i]]));
		})();
		conversion.catch(() => conversions.delete(key));
		conversions.set(key, conversion);
	}
	return conversion;
};

// ---------------------------------------------------------------------------
// DOM: find lyric lines on screen and add the romanization under them ("below")
// or swap their text for it ("replace" / solo romanización)
// ---------------------------------------------------------------------------

const ROMAJI_CLASS = "luna-romaji-line";
const style = new StyleTag(
	"RomajiLyrics",
	unloads,
	`
/* Tidal styles every span inside the lyrics (scale/blur/opacity/margins for inactive lines):
   keep our romanized line out of that, it follows its parent line instead */
.${ROMAJI_CLASS}.${ROMAJI_CLASS} {
	display: block;
	font-size: 0.6em;
	font-weight: 500;
	line-height: 1.3;
	letter-spacing: normal;
	opacity: 0.75 !important;
	margin: 0.15em 0 0 0 !important;
	transform: none !important;
	filter: none !important;
	transition: none !important;
	pointer-events: none;
	user-select: none;
}
/* Karaoke: the romanized line of the line being sung fills from left to right (lit / dim come from the original line) */
.${ROMAJI_CLASS}.kai-karaoke {
	opacity: 1 !important;
	color: transparent !important;
	background-image: linear-gradient(
		to right,
		var(--kai-lit) calc(var(--kai-fill) - 3%),
		var(--kai-dim) calc(var(--kai-fill) + 3%)
	);
	-webkit-background-clip: text;
	background-clip: text;
}
`,
);

/** original line (normalized) -> romanized. Accumulates across tracks, capped. */
const lineMap = new Map<string, string>();
const MAX_LINES = 3000;
const addLines = (lines: Map<string, string>) => {
	for (const [orig, romaji] of lines) {
		lineMap.delete(orig);
		lineMap.set(orig, romaji);
	}
	while (lineMap.size > MAX_LINES) lineMap.delete(lineMap.keys().next().value!);
	startObserver();
	scan(document.body);
};

/** Text nodes whose content we swapped in "replace" mode -> their original text */
const swapped = new Map<Text, { original: string; romaji: string }>();

const restoreSwapped = () => {
	for (const [text, { original, romaji }] of swapped) {
		if (text.isConnected && text.data === romaji) text.data = original;
	}
	swapped.clear();
};

const ownSpan = (parent: Element) => [...parent.children].find((c) => c.classList.contains(ROMAJI_CLASS));

const processText = (text: Text) => {
	const parent = text.parentElement;
	if (parent === null || parent.closest(`.${ROMAJI_CLASS}, input, textarea, [contenteditable="true"]`)) return;

	const swap = swapped.get(text);
	if (swap !== undefined) {
		if (text.data === swap.romaji) return; // our own change
		swapped.delete(text); // Tidal reused the node for another line
	}

	const existing = ownSpan(parent);
	const romaji = lineMap.get(norm(text.data));
	if (romaji === undefined || romaji === norm(text.data)) {
		// Line changed to something we don't know: drop a stale romanized line
		existing?.remove();
		return;
	}

	if (settings.mode === "replace") {
		existing?.remove();
		swapped.set(text, { original: text.data, romaji });
		text.data = romaji;
		return;
	}

	if (existing?.textContent === romaji) return;
	const span = (existing as HTMLElement | undefined) ?? document.createElement("span");
	span.className = ROMAJI_CLASS;
	span.textContent = romaji;
	span.dataset.key = norm(text.data); // which original line it belongs to (for the karaoke fill)
	if (!existing) parent.appendChild(span);
};

const scan = (root: Node) => {
	if (root.nodeType === Node.TEXT_NODE) return processText(root as Text);
	if (root.nodeType !== Node.ELEMENT_NODE) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (n) => (ROMANIZABLE.test((n as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
	});
	const found: Text[] = [];
	while (walker.nextNode()) found.push(walker.currentNode as Text);
	found.forEach(processText);
};

const observer = new MutationObserver((records) => {
	if (lineMap.size === 0) return;
	for (const record of records) {
		if (record.type === "characterData") processText(record.target as Text);
		else record.addedNodes.forEach(scan);
	}
});
let observing = false;
const startObserver = () => {
	if (observing) return;
	observer.observe(document.body, { subtree: true, childList: true, characterData: true });
	observing = true;
};
const cleanDom = () => {
	document.querySelectorAll(`.${ROMAJI_CLASS}`).forEach((el) => el.remove());
	restoreSwapped();
};
unloads.add(() => {
	observer.disconnect();
	observing = false;
	cleanDom();
});

// ---------------------------------------------------------------------------
// Karaoke fill for the romanized line being sung ("below" mode)
// Tidal's lyrics are timed per line (LRC), not per word: the fill runs across the line's time slot.
// ---------------------------------------------------------------------------

type Cue = { start: number; end: number; key: string };
/** Timed lines of the track whose lyrics are loaded */
let timeline: { trackId: string; cues: Cue[] } | undefined;

const parseLrc = (subtitles: string): Cue[] => {
	const cues: Omit<Cue, "end">[] = [];
	for (const line of subtitles.split(/\r?\n/)) {
		const m = LRC_LINE.exec(line);
		if (!m) continue;
		const key = norm(m[3]);
		for (const tag of m[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)) {
			cues.push({ start: Number(tag[1]) * 60 + Number(tag[2].replace(":", ".")), key });
		}
	}
	cues.sort((a, b) => a.start - b.start);
	return cues.map((c, i) => ({ ...c, end: cues[i + 1]?.start ?? c.start + 8 }));
};

/** Seconds the fill takes: the line's time slot, but not the whole instrumental break if there's a long gap */
const fillDuration = (cue: Cue, romaji: string) => Math.min(cue.end - cue.start, Math.max(1.5, romaji.length / 5 + 1));

let filled: HTMLElement | undefined;
const clearFill = () => {
	if (filled === undefined) return;
	filled.classList.remove("kai-karaoke");
	filled.style.removeProperty("--kai-fill");
	filled = undefined;
};

/** The romanized line on screen for `key`, preferring the one Tidal marks as the active line */
const spanFor = (key: string): HTMLElement | undefined => {
	const spans = [...document.querySelectorAll<HTMLElement>(`.${ROMAJI_CLASS}`)].filter((s) => s.dataset.key === key);
	return spans.find((s) => /_active_|_current_/.test(s.parentElement?.className ?? "")) ?? spans[0];
};

let currentTrackId: string | undefined;
let raf = 0;
const frame = () => {
	raf = requestAnimationFrame(frame);
	if (!settings.karaoke || settings.mode !== "below" || timeline === undefined || timeline.trackId !== currentTrackId) return clearFill();
	if (document.querySelector(`.${ROMAJI_CLASS}`) === null) return clearFill(); // lyrics not on screen

	const t = PlayState.currentTime;
	const cues = timeline.cues;
	let i = -1;
	for (let j = 0; j < cues.length && cues[j].start <= t; j++) i = j;
	const cue = cues[i];
	if (cue === undefined) return clearFill();

	const span = spanFor(cue.key);
	if (span === undefined) return clearFill();
	if (span !== filled) {
		clearFill();
		// Lit = the original line's colour (as bright as the kanji); dim = the same colour, faded
		const color = getComputedStyle(span.parentElement ?? span).color;
		span.style.setProperty("--kai-lit", color);
		span.style.setProperty("--kai-dim", `color-mix(in srgb, ${color} 40%, transparent)`);
		span.classList.add("kai-karaoke");
		filled = span;
	}
	const progress = Math.max(0, Math.min(1, (t - cue.start) / fillDuration(cue, span.textContent ?? "")));
	span.style.setProperty("--kai-fill", `${(progress * 106 - 3).toFixed(2)}%`); // -3%..103% so both ends are clean
};
raf = requestAnimationFrame(frame);
unloads.add(() => {
	cancelAnimationFrame(raf);
	clearFill();
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Fetch + convert the lyrics of a media item so its lines are recognised on screen */
const prime = async (mediaItem: MediaItem | undefined) => {
	if (mediaItem === undefined) return;
	currentTrackId = String(mediaItem.id);
	const lyrics = await mediaItem.lyrics().catch(() => undefined);
	if (lyrics === undefined) return;
	if (lyrics.subtitles) timeline = { trackId: String(mediaItem.id), cues: parseLrc(lyrics.subtitles) };
	const lang = detectLang(`${lyrics.lyrics ?? ""}\n${lyrics.subtitles ?? ""}`);
	if (lang === undefined) return;
	addLines(await convert(lyrics, lang));
};

/** Called on load and whenever the mode changes in the settings */
export const applyMode = () => {
	// Undo whatever the previous mode did, then redo it with the current one
	observer.takeRecords();
	cleanDom();
	if (lineMap.size > 0) {
		startObserver();
		scan(document.body);
	}
	MediaItem.fromPlaybackContext().then(prime).catch(trace.err.withContext("prime"));
};

MediaItem.onMediaTransition(unloads, (mediaItem) => {
	prime(mediaItem).catch(trace.err.withContext("prime"));
});

/** Smooth lyric animations even when Windows has "Animation effects" off */
export const applySmooth = () =>
	setForceMotion(settings.smoothLyrics).catch(trace.err.withContext("setForceMotion"));
unloads.add(() => {
	setForceMotion(false).catch(() => {});
});

const t = setTimeout(() => {
	applyMode();
	if (settings.smoothLyrics) applySmooth();
	// Download the Japanese dictionary (only the first time, ~17MB) and load it in the background
	warmup().catch(trace.msg.err.withContext("No se pudo cargar el diccionario japonés (¿sin conexión?)"));
});
unloads.add(() => clearTimeout(t));
