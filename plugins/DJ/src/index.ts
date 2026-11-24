import { type LunaUnload, Tracer } from "@luna/core";
import { MediaItem, PlayState, redux } from "@luna/lib";

import { aiFact, aiIntro } from "./ai.native";
import { artistBio, favoriteTracks, recommendations } from "./api";
import { debugLog } from "./debug.native";
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
/** Rejects if `promise` takes longer than `ms`, so one stuck step can't block the DJ */
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
	Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms))]);

const findPicks = async (seed: MediaItem, count: number): Promise<MediaItem[]> => {
	const started = Date.now();
	const { ids, errors } = await withTimeout(recommendations(seed.id), 15_000, "recommendations");
	if (errors.length > 0) trace.warn("Algunas fuentes de recomendaciones fallaron", errors);
	if (ids.length === 0) {
		// Quietly: the caller tries another seed
		dbg({ ev: "no-recs", seed: seed.id, title: seed.tidalItem.title, errors });
		return [];
	}
	const queued = PlayState.playQueue.elements.map((e: redux.PlayQueueElement) => String(e.mediaItemId));
	const exclude = new Set([...history, ...queued]);
	// Take from the most relevant ones, with a bit of randomness so it's not always the same order.
	// Never offer a track you skipped before.
	const pool = ids.filter((id) => !exclude.has(id) && !isSkippedTrack(id)).slice(0, Math.max(count * 5, 15));
	const picks: MediaItem[] = [];
	const avoided: MediaItem[] = [];
	let tries = 0;
	while (picks.length < count && pool.length > 0 && tries++ < 12) {
		const [id] = pool.splice(Math.floor(Math.random() * Math.min(pool.length, 6)), 1);
		const item = await withTimeout(MediaItem.fromId(id), 8_000, `load ${id}`).catch((err: unknown) => {
			dbg({ ev: "load-fail", id, err: String(err) });
			return undefined;
		});
		// Skip what Tidal can't play right now (otherwise the player sits at 0:00)
		if (item === undefined || item.tidalItem.allowStreaming === false || item.tidalItem.streamReady === false) continue;
		// Artists you keep skipping go to the back of the line
		if (isAvoidedArtist(item.tidalItem.artists?.[0]?.id)) avoided.push(item);
		else picks.push(item);
	}
	// Only fall back to avoided artists if there's nothing else
	while (picks.length < count && avoided.length > 0) picks.push(avoided.shift()!);
	dbg({ ev: "picks", seed: seed.id, recs: ids.length, errors, pool: pool.length, tries, picked: picks.map((p) => p.id), ms: Date.now() - started });
	const seedInfo = infoOf(seed);
	for (const p of picks) {
		djPicks.set(String(p.id), seedInfo);
		prefetchComment(p, seedInfo); // so the AI intro is ready when the track starts
	}
	return picks;
};

/**
 * Tries seeds in order until one gives picks: the preferred ones, then the last tracks played this session.
 * Some tracks get no recommendations from Tidal at all; without this the DJ would keep retrying the same one.
 */
const findPicksFromSeeds = async (preferred: (redux.ItemId | undefined)[], count: number): Promise<MediaItem[]> => {
	const recent = [...history].reverse().slice(0, 6);
	const seeds = [...new Set([...preferred.filter((id) => id !== undefined).map(String), ...recent])];
	for (const seedId of seeds) {
		const seed = await withTimeout(MediaItem.fromId(seedId), 8_000, `seed ${seedId}`).catch(() => undefined);
		if (seed === undefined) continue;
		const picks = await findPicks(seed, count);
		if (picks.length > 0) return picks;
	}
	dbg({ ev: "no-picks-any-seed", seeds });
	return [];
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

/**
 * Adds the DJ's picks to the queue right after the element at `afterIndex`.
 *
 * Tidal's "play next" / "add to queue" put tracks in "Tu cola de reproducción" (priority_keep), which are consumed
 * after playing and never show up in the queue's history. We insert them as part of what's playing (priority_none),
 * like an album or mix track, which Tidal turns into history after they play: on the cloud queue with Tidal's own
 * insert, on the local queue by rebuilding the element list. If they don't land in the queue within a few seconds
 * (Tidal changed something), fall back to the regular "play next" / "add to queue".
 */
const addToQueue = (picks: MediaItem[], afterIndex: number, fallback: "next" | "last", offset = 0) => {
	const ids = picks.map((p) => (/^\d+$/.test(String(p.id)) ? Number(p.id) : p.id));
	const regular = () =>
		fallback === "next"
			? redux.actions["playQueue/ADD_NEXT"]({ context: { type: "UNKNOWN" }, mediaItemIds: ids, offset })
			: redux.actions["playQueue/ADD_LAST"]({ context: { type: "UNKNOWN" }, mediaItemIds: ids });

	const q = PlayState.playQueue;
	const anchor = q.elements[afterIndex];
	const actions = redux.actions as unknown as Record<string, ((payload: unknown) => unknown) | undefined>;
	const addToCloudQueue = actions["cloudQueue/ADD_ITEMS_TO_CLOUD_QUEUE"];
	const appendElements = actions["playQueue/APPEND_ELEMENTS"];
	const moveTrack = actions["playQueue/MOVE_TRACK"];
	const wasPlaying = PlayState.playing;
	dbg({ ev: "add", fallback, qType: q.type, cloudAction: addToCloudQueue !== undefined, anchorUid: anchor?.uid, afterIndex, len: q.elements.length, ids });

	try {
		if (q.type === "cloudV2" && addToCloudQueue !== undefined && anchor?.uid !== undefined) {
			// Cloud queue: Tidal's own insert, as part of what's playing
			addToCloudQueue({ context: { type: "UNKNOWN" }, itemId: anchor.uid, mediaItemIds: ids, mode: "append", priority: "priority_none" });
			dbg({ ev: "method", method: "cloud" });
		} else if (appendElements !== undefined && moveTrack !== undefined && anchor !== undefined) {
			// Local queue: add them at the end (like Tidal's own "A continuación" mix) and move them into place
			// (like dragging in the queue panel). Neither reloads the current track, unlike rebuilding the queue.
			const stamp = Date.now().toString(16);
			const inserted = ids.map((mediaItemId, k) => ({
				context: { type: "UNKNOWN" },
				mediaItemId,
				priority: "priority_none",
				uid: `pq__kaidj${stamp}__${q.uniqueIdCounter + 1 + k}`,
			}));
			appendElements({ elements: inserted });
			inserted.forEach((el, k) => {
				const from = PlayState.playQueue.elements.findIndex((e: redux.PlayQueueElement) => e.uid === el.uid);
				const to = afterIndex + 1 + k;
				if (from > -1 && from !== to) moveTrack({ fromIndex: from, toIndex: to });
			});
			dbg({ ev: "method", method: "local-append-move" });
		} else {
			dbg({ ev: "regular", reason: "no cloud action / append+move / anchor" });
			return regular();
		}
	} catch (err) {
		dbg({ ev: "regular", reason: `insert threw: ${String(err)}` });
		trace.warn("queue insert failed, using play next", err);
		return regular();
	}
	// Safety net: if changing the queue left the music paused, carry on playing
	if (wasPlaying) {
		setTimeout(() => {
			if (!PlayState.playing) {
				dbg({ ev: "resume", reason: "paused after queue change" });
				PlayState.play();
			}
		}, 1200);
	}
	setTimeout(() => {
		const elements = PlayState.playQueue.elements;
		const landed = elements.filter((e: redux.PlayQueueElement) => ids.some((id) => String(id) === String(e.mediaItemId)));
		dbg({ ev: "check", landed: landed.map((e: redux.PlayQueueElement) => ({ id: e.mediaItemId, priority: e.priority, ctx: e.context?.type })) });
		if (landed.length === 0) {
			dbg({ ev: "regular", reason: "picks didn't reach the queue" });
			trace.warn("DJ picks didn't reach the queue, using play next");
			regular();
		}
	}, 6000);
};

/** Local diagnostic log (queue structure only), see debug.native.ts */
const dbg = (entry: Record<string, unknown>) => {
	debugLog(entry).catch(() => {});
};
/** Compact view of the queue around the current track: priority + whether it's a DJ pick */
const queueSnapshot = () => {
	const q = PlayState.playQueue;
	return {
		type: q.type,
		currentIndex: q.currentIndex,
		len: q.elements.length,
		around: q.elements.slice(Math.max(0, q.currentIndex - 4), q.currentIndex + 6).map((e: redux.PlayQueueElement, i: number) => ({
			rel: i + Math.max(0, q.currentIndex - 4) - q.currentIndex,
			id: e.mediaItemId,
			p: e.priority,
			dj: djPicks.has(String(e.mediaItemId)),
		})),
	};
};

let topping: Promise<void> | undefined;
const topUp = () =>
	(topping ??= withTimeout(doTopUp(), 45_000, "topUp")
		.catch((err: unknown) => {
			dbg({ ev: "topup-error", err: String(err) });
			trace.warn("topUp", err);
		})
		.finally(() => (topping = undefined)));

const doTopUp = async () => {
	if (PlayState.repeatMode !== redux.RepeatMode.Off && !session) return; // queue loops anyway
	const q = PlayState.playQueue;

	if (session) {
		// DJ Kai session: the DJ's picks go right after the current track, ahead of the rest of the queue
		const ahead = djPicksAhead();
		const missing = settings.ahead - ahead;
		if (missing <= 0) return;
		const picks = await findPicksFromSeeds([q.elements[q.currentIndex + ahead]?.mediaItemId, q.elements[q.currentIndex]?.mediaItemId], missing);
		if (picks.length === 0 || !session) return;
		addToQueue(picks, q.currentIndex + ahead, "next", ahead);
		return;
	}

	// Auto mode: only when the queue is about to run out, chaining from its last track
	if (!settings.enabled) return;
	const missing = settings.ahead - upcoming();
	if (missing <= 0) return;
	const picks = await findPicksFromSeeds([q.elements.at(-1)?.mediaItemId, q.elements[q.currentIndex]?.mediaItemId], missing);
	if (picks.length === 0) return;
	addToQueue(picks, q.elements.length - 1, "last");
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
	voicePercent: settings.voicePercent,
	onAzureError: (err) => {
		// Warn once per session, then keep falling back to the Windows voice quietly
		if (azureWarned) return trace.err.withContext("Azure")(err);
		azureWarned = true;
		trace.msg.err.withContext("La voz de Azure falló, uso la de Windows")(err);
	},
});

export const say = (text: string, stillWanted?: () => boolean) => speak(text, voiceOptions(), stillWanted).catch(trace.err.withContext("speak"));

/** Bumped on every track change: lines about an earlier track are dropped instead of queued */
let announceGen = 0;

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

/** Seconds the player has been sitting at the very end of a track without moving on */
let stuckAtEnd = 0;
/** Start-of-track watchdog state, reset on every track change */
let startNudged = false;
let startSkipped = false;
let ticksSinceTopUp = 0;

const tick = setInterval(() => {
	if (now === undefined) return;
	const pos = PlayState.currentTime;
	if (pos > 0) now.pos = pos;

	// Watchdog: during a DJ Kai session, if a track reached its end and the player didn't move on, skip forward
	const q = PlayState.playQueue;
	if (session && PlayState.playing && now.duration > 0 && pos >= now.duration - 1 && q.currentIndex < q.elements.length - 1) {
		if (++stuckAtEnd >= 5) {
			stuckAtEnd = 0;
			dbg({ ev: "watchdog-next", id: now.id, pos, duration: now.duration });
			PlayState.next();
			PlayState.play();
		}
	} else stuckAtEnd = 0;

	// Watchdog: a track that stays at 0:00 after it started (Tidal couldn't load it): try playing, then skip
	const sinceStart = Date.now() - lastTransition.at;
	if (session && pos < 1 && sinceStart > 10_000 && sinceStart < 40_000 && q.currentIndex < q.elements.length - 1) {
		if (!startNudged) {
			startNudged = true;
			dbg({ ev: "watchdog-start-play", id: now.id });
			PlayState.play();
		} else if (sinceStart > 20_000 && !startSkipped) {
			startSkipped = true;
			dbg({ ev: "watchdog-start-skip", id: now.id });
			PlayState.next();
			PlayState.play();
		}
	}

	// Every 15 s during a session, make sure the DJ's picks are lined up (in case a top-up failed or timed out)
	if (session && ++ticksSinceTopUp >= 15) {
		ticksSinceTopUp = 0;
		if (djPicksAhead() < settings.ahead) topUp().catch(() => {});
	}
	if (midPlan && !midPlan.done && midPlan.id === now.id && now.pos >= midPlan.at && PlayState.playing && session) {
		midPlan.done = true;
		const plan = midPlan;
		Promise.race([plan.text, new Promise<string>((r) => setTimeout(() => r(""), 4000))]).then((text) => {
			const stillCurrent = () => session && now?.id === plan.id;
			if (text && stillCurrent()) say(text, stillCurrent);
		});
	}
}, 1000);
unloads.add(() => clearInterval(tick));

/** Last track change, to ignore Tidal firing it again for the same track (e.g. when it reloads it) */
let lastTransition = { id: "", at: 0 };

MediaItem.onMediaTransition(unloads, async (item) => {
	const id = String(item.id);
	const nowMs = Date.now();
	if (lastTransition.id === id && nowMs - lastTransition.at < 5000) {
		dbg({ ev: "duplicate-transition", id });
		return;
	}
	lastTransition = { id, at: nowMs };
	startNudged = false;
	startSkipped = false;
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
	// The DJ itself changed the track (starting a session from a favourite): don't cut its own greeting
	const djChangedTrack = ignoreNextSkip;
	ignoreNextSkip = false;
	// New track: cut whatever the DJ was saying about the previous one, and drop anything still queued for it
	const gen = ++announceGen;
	if (session && !djChangedTrack) stopSpeaking();
	now = { id, artists: (item.tidalItem.artists ?? []).map((a) => a.id), duration: item.tidalItem.duration ?? 0, pos: 0 };
	planMidComment(item);
	dbg({ ev: "transition", id, djPick: djPicks.has(id), session, queue: queueSnapshot() });

	const seed = djPicks.get(id);
	// The DJ only talks while DJ Kai is on (the button), never on its own when Tidal starts
	if (session && settings.voice && (seed !== undefined || settings.announceAll)) {
		// The first time the DJ talks in a session it introduces itself
		const intro = introduced ? "" : `${DJ_INTRO} `;
		introduced = true;
		const textPromise = introFor(item, seed);
		// Let the track start before talking over it
		const stillCurrent = () => session && gen === announceGen && now?.id === id;
		setTimeout(async () => {
			const text = await textPromise;
			if (stillCurrent()) say(intro + text, stillCurrent);
		}, 800);
	}
	topUp().catch(trace.err.withContext("topUp"));
});

/** Called from the settings when the auto-fill switch changes (silent: the DJ only talks with DJ Kai on) */
export const onEnabledChange = async () => {
	topUp().catch(trace.err.withContext("topUp"));
};

/** "Probar comentario IA" button in the settings */
export const testAiComment = async (onText: (text: string) => void, stillWanted: () => boolean) => {
	const current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	const track: TrackInfo = current ? infoOf(current) : { title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", year: "1975" };
	const result = await aiIntro(settings.anthropicKey, settings.aiModel, track, undefined, { time: timeContext() });
	onText(result.text); // show it while it's being read
	if (stillWanted()) await say(result.text);
	return result.text;
};

mountButton(unloads, {
	isOn: isSessionOn,
	onChange: onSessionChange,
	onClick: () => {
		toggleSession().catch(trace.msg.err.withContext("DJ Kai"));
	},
});

dbg({
	ev: "load",
	cloudActions: Object.keys(redux.actions).filter((k) => k.startsWith("cloudQueue/")),
	queueStateKeys: Object.keys(redux.store.getState()).filter((k) => /queue/i.test(k)),
	queue: queueSnapshot(),
});

// On load: remember the current track and fill the queue if needed
const t = setTimeout(async () => {
	const current = await MediaItem.fromPlaybackContext().catch(() => undefined);
	if (current) history.add(String(current.id));
	topUp().catch(trace.err.withContext("topUp"));
}, 1000);
unloads.add(() => clearTimeout(t));
