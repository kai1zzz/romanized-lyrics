import { type LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState, redux } from "@luna/lib";

import { aiFact, aiIntro } from "./ai.native";
import { artistBio, favoriteTracks, recommendations } from "./api";
import { wikipediaFacts } from "./facts.native";
import { mountButton } from "./button";
import { DJ_INTRO, greeting, timeContext, type TrackInfo, trackIntro } from "./lines";
import { settings } from "./Settings";
import { isAvoidedArtist, isSkippedTrack, recordSkip } from "./skips";
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

/** How many DJ picks are lined up right after the current track */
const djPicksAhead = () => {
	const q = PlayState.playQueue;
	let n = 0;
	for (let i = q.currentIndex + 1; i < q.elements.length && djPicks.has(String(q.elements[i].mediaItemId)); i++) n++;
	return n;
};

/** Up to `count` playable tracks similar to `seed` that haven't played and aren't queued */
const findPicks = async (seed: MediaItem, count: number): Promise<MediaItem[]> => {
	const { ids, errors } = await recommendations(seed.id);
	if (errors.length > 0) trace.warn("Algunas fuentes de recomendaciones fallaron", errors);
	if (ids.length === 0) {
		trace.msg.warn(`El DJ no encontró canciones parecidas a "${seed.tidalItem.title}"`);
		return [];
	}
	const queued = PlayState.playQueue.elements.map((e: redux.PlayQueueElement) => String(e.mediaItemId));
	const exclude = new Set([...history, ...queued]);
	// Take from the most relevant ones, with a bit of randomness so it's not always the same order.
	// Never offer a track you skipped before.
	const pool = ids.filter((id) => !exclude.has(id) && !isSkippedTrack(id)).slice(0, Math.max(count * 5, 15));
	const picks: MediaItem[] = [];
	const avoided: MediaItem[] = [];
	while (picks.length < count && pool.length > 0) {
		const [id] = pool.splice(Math.floor(Math.random() * Math.min(pool.length, 6)), 1);
		const item = await MediaItem.fromId(id).catch(() => undefined);
		if (item === undefined || item.tidalItem.allowStreaming === false) continue;
		// Artists you keep skipping go to the back of the line
		if (isAvoidedArtist(item.tidalItem.artists?.[0]?.id)) avoided.push(item);
		else picks.push(item);
	}
	// Only fall back to avoided artists if there's nothing else
	while (picks.length < count && avoided.length > 0) picks.push(avoided.shift()!);
	const seedInfo = infoOf(seed);
	for (const p of picks) {
		djPicks.set(String(p.id), seedInfo);
		prefetchComment(p, seedInfo); // so the AI intro is ready when the track starts
	}
	return picks;
};

// ---------------------------------------------------------------------------
// AI comments (Claude)
// ---------------------------------------------------------------------------

const aiReady = () => settings.aiComments && settings.anthropicKey.trim().length > 20;
/** trackId -> AI intro being written / already written */
const aiComments = new Map<string, Promise<string>>();
let aiWarned = false;

const prefetchComment = (item: MediaItem, previous?: TrackInfo) => {
	if (!aiReady() || !session) return;
	const id = String(item.id);
	if (aiComments.has(id)) return;
	const p = aiIntro(settings.anthropicKey, settings.aiModel, infoOf(item), previous, { kind: "intro", time: timeContext() }).then((r) => r.text);
	p.catch(() => aiComments.delete(id)); // let a later attempt retry
	aiComments.set(id, p);
};

/** The intro to say for `item`: Claude's if it arrives in time, otherwise a template */
const introFor = async (item: MediaItem, previous?: TrackInfo): Promise<string> => {
	const fallback = trackIntro(infoOf(item), previous);
	if (!aiReady()) return fallback;
	prefetchComment(item, previous);
	const pending = aiComments.get(String(item.id));
	if (pending === undefined) return fallback;
	try {
		return await Promise.race([pending, new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))]);
	} catch (err) {
		if (!aiWarned && !(err instanceof Error && err.message === "timeout")) {
			aiWarned = true;
			trace.msg.err.withContext("Los comentarios con IA fallaron, uso las frases normales")(err);
		} else trace.warn("AI intro", err);
		return fallback;
	}
};

let topping: Promise<void> | undefined;
const topUp = () => (topping ??= doTopUp().finally(() => (topping = undefined)));

const doTopUp = async () => {
	if (PlayState.repeatMode !== redux.RepeatMode.Off && !session) return; // queue loops anyway
	const q = PlayState.playQueue;

	if (session) {
		// DJ Kai session: the DJ's picks go right after the current track, ahead of the rest of the queue
		const ahead = djPicksAhead();
		const missing = settings.ahead - ahead;
		if (missing <= 0) return;
		const seed = await MediaItem.fromId(q.elements[q.currentIndex + ahead]?.mediaItemId);
		if (seed === undefined) return;
		const picks = await findPicks(seed, missing);
		if (picks.length === 0 || !session) return;
		redux.actions["playQueue/ADD_NEXT"]({ context: { type: "UNKNOWN" }, mediaItemIds: picks.map((p) => p.id), offset: ahead });
		return;
	}

	// Auto mode: only when the queue is about to run out, chaining from its last track
	if (!settings.enabled) return;
	const missing = settings.ahead - upcoming();
	if (missing <= 0) return;
	const seed = await MediaItem.fromId((q.elements.at(-1) ?? q.elements[q.currentIndex])?.mediaItemId);
	if (seed === undefined) return;
	const picks = await findPicks(seed, missing);
	if (picks.length === 0) return;
	redux.actions["playQueue/ADD_LAST"]({ context: { type: "UNKNOWN" }, mediaItemIds: picks.map((p) => p.id) });
};

// ---------------------------------------------------------------------------
// DJ Kai session (the button in the player bar)
// ---------------------------------------------------------------------------

/** While on, the DJ keeps its own picks lined up next, instead of waiting for the queue to end */
let session = false;
const sessionListeners = new Set<(on: boolean) => void>();
export const isSessionOn = () => session;
export const onSessionChange = (cb: (on: boolean) => void) => {
	sessionListeners.add(cb);
	return () => sessionListeners.delete(cb);
};
const setSession = (on: boolean) => {
	session = on;
	sessionListeners.forEach((cb) => cb(on));
};

export const toggleSession = async () => {
	if (session) {
		setSession(false);
		stopSpeaking();
		if (settings.voice) say("Vale, te dejo con tu cola. ¡Hasta luego!");
		return;
	}
	setSession(true);
	introduced = true;

	let current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	if (current === undefined || PlayState.playQueue.elements.length === 0) {
		// Nothing playing: start from one of the user's recent favourites
		const favs = await favoriteTracks().catch(() => []);
		const id = favs[Math.floor(Math.random() * Math.min(favs.length, 30))];
		if (id === undefined) {
			setSession(false);
			trace.msg.warn("Pon una canción (o marca alguna como favorita) para que DJ Kai sepa por dónde empezar.");
			return;
		}
		current = await MediaItem.fromId(id);
		if (current === undefined) return setSession(false);
		if (settings.voice) say(`${greeting()} ${DJ_INTRO} Empezamos con algo que te gusta.`);
		ignoreNextSkip = true; // we're changing the track, not you
		PlayState.play(current.id);
	} else if (settings.voice) {
		const c = infoOf(current);
		say(`${greeting()} ${DJ_INTRO} Después de ${c.title}, sigo yo con música parecida.`);
	}
	await topUp().catch(trace.err.withContext("topUp"));
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

// ---------------------------------------------------------------------------
// Playback tracking: skip learning + mid-song comments
// ---------------------------------------------------------------------------

type NowPlaying = { id: string; artists: (string | number)[]; duration: number; pos: number };
let now: NowPlaying | undefined;
/** Set when the DJ itself changes the track, so it isn't counted as your skip */
let ignoreNextSkip = false;

/** DJ picks played since the last mid-song comment */
let songsSinceMid = 0;
type MidPlan = { id: string; at: number; text: Promise<string>; done: boolean };
let midPlan: MidPlan | undefined;

const planMidComment = (item: MediaItem) => {
	midPlan = undefined;
	if (!session || !settings.voice || !settings.midComments) return;
	songsSinceMid++;
	const duration = item.tidalItem.duration ?? 0;
	if (songsSinceMid < settings.midEvery || duration < 120) return;
	songsSinceMid = 0;
	// Curious facts need Claude; without it the DJ stays quiet rather than saying filler
	if (!aiReady()) return;
	const text = curiousFact(item).then((fact) => {
		// Nothing worth saying about this one: try again on the next song
		if (!fact) songsSinceMid = settings.midEvery - 1;
		return fact;
	});
	midPlan = { id: String(item.id), at: Math.min(duration * 0.45, 100), text, done: false };
};

/** Facts already told per artist, so the DJ doesn't repeat itself */
const toldFacts = new Map<string, string[]>();

/**
 * A curious fact about the track or its artist, taken from Wikipedia + Tidal's artist bio (not from the model's memory).
 * Uses the same model as the intros.
 */
const curiousFact = async (item: MediaItem): Promise<string> => {
	const info = infoOf(item);
	const artistId = item.tidalItem.artists?.[0]?.id;
	const artistKey = String(artistId ?? info.artist);
	const [wiki, bio] = await Promise.all([
		wikipediaFacts(info.title, info.artist).catch(() => ""),
		artistId !== undefined ? artistBio(artistId) : Promise.resolve(undefined),
	]);
	const sources = [wiki, bio ? `Biografía de Tidal sobre ${info.artist}:\n${bio}` : ""].filter(Boolean).join("\n\n");
	const told = toldFacts.get(artistKey) ?? [];
	const fact = await aiFact(settings.anthropicKey, settings.aiModel, info, sources, told)
		.then((r) => r.text)
		.catch((err: unknown) => {
			trace.warn("AI fact", err);
			return "";
		});
	if (fact) toldFacts.set(artistKey, [...told, fact].slice(-8));
	return fact;
};

const tick = setInterval(() => {
	if (now === undefined) return;
	const pos = PlayState.currentTime;
	if (pos > 0) now.pos = pos;
	if (midPlan && !midPlan.done && midPlan.id === now.id && now.pos >= midPlan.at && PlayState.playing && session) {
		midPlan.done = true;
		const plan = midPlan;
		Promise.race([plan.text, new Promise<string>((r) => setTimeout(() => r(""), 4000))]).then((text) => {
			if (text && session && now?.id === plan.id) say(text);
		});
	}
}, 1000);
unloads.add(() => clearInterval(tick));

MediaItem.onMediaTransition(unloads, async (item) => {
	const id = String(item.id);
	history.add(id);

	// Did you skip the DJ's previous pick? (left it in the first 30 s / first half, well before the end)
	const prev = now;
	if (prev && prev.id !== id && djPicks.has(prev.id) && !ignoreNextSkip) {
		const early = prev.pos < Math.min(30, prev.duration * 0.5);
		const farFromEnd = prev.duration - prev.pos > 15;
		if (early && farFromEnd) {
			recordSkip(prev.id, prev.artists);
			trace.log(`Aprendido: saltaste "${djPicks.get(prev.id)?.title ?? prev.id}"`);
		}
	}
	ignoreNextSkip = false;
	now = { id, artists: (item.tidalItem.artists ?? []).map((a) => a.id), duration: item.tidalItem.duration ?? 0, pos: 0 };
	planMidComment(item);

	const seed = djPicks.get(id);
	// The DJ only talks while DJ Kai is on (the button), never on its own when Tidal starts
	if (session && settings.voice && (seed !== undefined || settings.announceAll)) {
		// The first time the DJ talks in a session it introduces itself
		const intro = introduced ? "" : `${DJ_INTRO} `;
		introduced = true;
		const textPromise = introFor(item, seed);
		// Let the track start before talking over it
		setTimeout(async () => {
			const text = await textPromise;
			if (session && String((await MediaItem.fromPlaybackContext().catch(() => undefined))?.id) === id) say(intro + text);
		}, 800);
	}
	topUp().catch(trace.err.withContext("topUp"));
});

/** Called from the settings when the auto-fill switch changes (silent: the DJ only talks with DJ Kai on) */
export const onEnabledChange = async () => {
	topUp().catch(trace.err.withContext("topUp"));
};

/** "Probar comentario IA" button in the settings */
export const testAiComment = async () => {
	const current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	const track: TrackInfo = current ? infoOf(current) : { title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", year: "1975" };
	const result = await aiIntro(settings.anthropicKey, settings.aiModel, track, undefined, { time: timeContext() });
	await say(result.text);
	return result.text;
};

mountButton(unloads, {
	isOn: isSessionOn,
	onChange: onSessionChange,
	onClick: () => {
		toggleSession().catch(trace.msg.err.withContext("DJ Kai"));
	},
});

// On load: remember the current track and fill the queue if needed
const t = setTimeout(async () => {
	const current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	if (current) history.add(String(current.id));
	topUp().catch(trace.err.withContext("topUp"));
}, 1000);
unloads.add(() => clearTimeout(t));
