import { type LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState, redux } from "@luna/lib";

import { recommendations } from "./api";
import { DJ_INTRO, djHello, type TrackInfo, trackIntro } from "./lines";
import { settings } from "./Settings";
import { speak, stopSpeaking, type VoiceOptions } from "./voice";

export const { trace, errSignal } = Tracer("[DJ]");
export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();
unloads.add(stopSpeaking);

// ---------------------------------------------------------------------------
// Track info
// ---------------------------------------------------------------------------

const infoOf = (item: MediaItem): TrackInfo => {
	const t = item.tidalItem;
	const artists = (t.artists ?? []).map((a) => a.name).filter(Boolean);
	const artist = artists.length > 1 ? `${artists.slice(0, -1).join(", ")} y ${artists.at(-1)}` : (artists[0] ?? "artista desconocido");
	const date = t.releaseDate ?? t.album?.releaseDate ?? t.streamStartDate;
	return {
		title: (t.title ?? "").replace(/\s*[([](feat|ft|with)\.?[^)\]]*[)\]]/i, ""),
		artist,
		album: t.album?.title ?? undefined,
		year: date ? String(new Date(date).getFullYear()) : undefined,
	};
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/** Tracks the DJ added -> the track that inspired them */
const djPicks = new Map<string, TrackInfo>();
/** Everything played this session, so the DJ doesn't repeat itself */
const history = new Set<string>();

const upcoming = () => {
	const q = PlayState.playQueue;
	return q.elements.length - q.currentIndex - 1;
};

let topping: Promise<void> | undefined;
const topUp = () => (topping ??= doTopUp().finally(() => (topping = undefined)));

const doTopUp = async () => {
	if (!settings.enabled) return;
	if (PlayState.repeatMode !== redux.RepeatMode.Off) return; // queue loops anyway
	const missing = settings.ahead - upcoming();
	if (missing <= 0) return;

	// Chain from the last track in the queue so the picks flow like a radio
	const q = PlayState.playQueue;
	const seedElement = q.elements.at(-1) ?? q.elements[q.currentIndex];
	const seed = await MediaItem.fromId(seedElement?.mediaItemId);
	if (seed === undefined) return;

	const { ids, errors } = await recommendations(seed.id);
	if (errors.length > 0) trace.warn("Algunas fuentes de recomendaciones fallaron", errors);
	if (ids.length === 0) {
		trace.msg.warn(`El DJ no encontró canciones parecidas a "${seed.tidalItem.title}"`);
		return;
	}

	const exclude = new Set([...history, ...q.elements.map((e: redux.PlayQueueElement) => String(e.mediaItemId))]);
	// Take from the most relevant ones, with a bit of randomness so it's not always the same order
	const pool = ids.filter((id) => !exclude.has(id)).slice(0, Math.max(missing * 4, 12));
	const picks: MediaItem[] = [];
	while (picks.length < missing && pool.length > 0) {
		const [id] = pool.splice(Math.floor(Math.random() * Math.min(pool.length, 6)), 1);
		const item = await MediaItem.fromId(id).catch(() => undefined);
		if (item !== undefined && item.tidalItem.allowStreaming !== false) picks.push(item);
	}
	if (picks.length === 0) return;

	const seedInfo = infoOf(seed);
	for (const p of picks) djPicks.set(String(p.id), seedInfo);
	redux.actions["playQueue/ADD_LAST"]({ context: { type: "UNKNOWN" }, mediaItemIds: picks.map((p) => p.id) });
	trace.log(`Añadidas ${picks.length} canciones parecidas a "${seedInfo.title}"`);
};

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

let azureWarned = false;
export const voiceOptions = (): VoiceOptions => ({
	engine: settings.engine,
	voiceName: settings.voiceName,
	azureKey: settings.azureKey,
	azureRegion: settings.azureRegion,
	azureVoice: settings.azureVoice,
	duckPercent: settings.duckPercent,
	onAzureError: (err) => {
		// Warn once per session, then keep falling back to the Windows voice quietly
		if (azureWarned) return trace.err.withContext("Azure")(err);
		azureWarned = true;
		trace.msg.err.withContext("La voz de Azure falló, uso la de Windows")(err);
	},
});

export const say = (text: string) => speak(text, voiceOptions()).catch(trace.err.withContext("speak"));

/** Whether the DJ already introduced itself this session */
let introduced = false;

MediaItem.onMediaTransition(unloads, async (item) => {
	const id = String(item.id);
	history.add(id);

	const seed = djPicks.get(id);
	if (settings.enabled && settings.voice && (seed !== undefined || settings.announceAll)) {
		// The first time the DJ talks in a session it introduces itself
		const intro = introduced ? "" : `${DJ_INTRO} `;
		introduced = true;
		// Let the track start before talking over it
		setTimeout(() => say(intro + trackIntro(infoOf(item), seed)), 800);
	}
	topUp().catch(trace.err.withContext("topUp"));
});

/** Called from the settings when the DJ is switched on/off */
export const onEnabledChange = async () => {
	if (!settings.enabled) {
		stopSpeaking();
		return;
	}
	const current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	if (settings.voice) {
		introduced = true;
		say(djHello(current ? infoOf(current) : undefined));
	}
	topUp().catch(trace.err.withContext("topUp"));
};

// On load: remember the current track and fill the queue if needed
const t = setTimeout(async () => {
	const current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	if (current) history.add(String(current.id));
	topUp().catch(trace.err.withContext("topUp"));
}, 1000);
unloads.add(() => clearTimeout(t));
