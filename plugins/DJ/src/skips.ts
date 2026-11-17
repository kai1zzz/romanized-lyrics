// Learns from the DJ's picks you skip: never offers that track again, and avoids artists you keep skipping.
// Stored locally (Luna plugin storage), no AI involved.
import { ReactiveStore } from "@luna/core";

const MAX_TRACKS = 1000;
/** After this many skipped DJ picks of the same artist, the DJ stops choosing them */
export const ARTIST_SKIP_LIMIT = 2;

export const skipStore = await ReactiveStore.getPluginStorage("KaiDJSkips", {
	tracks: [] as string[],
	artists: {} as Record<string, number>,
});

export const isSkippedTrack = (id: string) => skipStore.tracks.includes(id);
export const isAvoidedArtist = (artistId: string | number | undefined) =>
	artistId !== undefined && (skipStore.artists[String(artistId)] ?? 0) >= ARTIST_SKIP_LIMIT;

export const recordSkip = (trackId: string, artistIds: (string | number)[]) => {
	if (!skipStore.tracks.includes(trackId)) skipStore.tracks = [...skipStore.tracks, trackId].slice(-MAX_TRACKS);
	const artists = { ...skipStore.artists };
	for (const a of artistIds.slice(0, 1)) artists[String(a)] = (artists[String(a)] ?? 0) + 1; // main artist only
	skipStore.artists = artists;
};

export const skipStats = () => ({
	tracks: skipStore.tracks.length,
	artists: Object.values(skipStore.artists).filter((n) => n >= ARTIST_SKIP_LIMIT).length,
});

export const forgetSkips = () => {
	skipStore.tracks = [];
	skipStore.artists = {};
};
