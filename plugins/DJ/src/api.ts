import { redux, TidalApi } from "@luna/lib";

const countryCode = () => redux.store.getState().session.countryCode;

const getJson = async <T>(url: string, accept = "application/json"): Promise<T> => {
	// Never wait forever on a request: a stuck one would block the DJ from adding songs
	const res = await fetch(url, { headers: { ...(await TidalApi.getAuthHeaders()), Accept: accept }, signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
	return res.json() as Promise<T>;
};

/** "Similar tracks" from Tidal's OpenAPI (the same endpoint the app uses for its similar-tracks list) */
const similarTracks = async (trackId: redux.ItemId): Promise<string[]> => {
	const json = await getJson<{ data?: { id: string; type: string }[] }>(
		`https://openapi.tidal.com/v2/tracks/${trackId}/relationships/similarTracks?countryCode=${countryCode()}`,
		"application/vnd.api+json",
	);
	return json.data?.filter((d) => d.type === "tracks").map((d) => String(d.id)) ?? [];
};

/** Track radio from the classic v1 API ("Go to track radio") */
const trackRadio = async (trackId: redux.ItemId): Promise<string[]> => {
	const json = await getJson<{ items?: { id: number | string }[] }>(`https://desktop.tidal.com/v1/tracks/${trackId}/radio?limit=50&${TidalApi.queryArgs()}`);
	return json.items?.map((i) => String(i.id)) ?? [];
};

/** The user's most recently favourited tracks (used to start a DJ session when nothing is playing) */
export const favoriteTracks = async (): Promise<string[]> => {
	const userId = redux.store.getState().session.userId;
	const json = await getJson<{ items?: { item?: { id: number | string } }[] }>(
		`https://desktop.tidal.com/v1/users/${userId}/favorites/tracks?limit=100&order=DATE&orderDirection=DESC&${TidalApi.queryArgs()}`,
	);
	return json.items?.flatMap((i) => (i.item?.id !== undefined ? [String(i.item.id)] : [])) ?? [];
};

/** Tidal's artist biography as plain text (the same bio shown on the artist page), or undefined */
export const artistBio = async (artistId: redux.ItemId): Promise<string | undefined> => {
	const json = await getJson<{ text?: string; source?: string }>(`https://desktop.tidal.com/v1/artists/${artistId}/bio?${TidalApi.queryArgs()}`).catch(
		() => undefined,
	);
	const text = json?.text
		?.replace(/\[wimpLink[^\]]*\](.*?)\[\/wimpLink\]/g, "$1") // [wimpLink artistId="1"]Name[/wimpLink] -> Name
		.replace(/<[^>]+>/g, " ")
		.replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": " " })[m] ?? "'")
		.replace(/\s+/g, " ")
		.trim();
	return text ? text.slice(0, 4000) : undefined;
};

export type Recommendations = { ids: string[]; errors: string[] };

/** Recommendations for a track, interleaving both sources (so if one fails the other still works) */
export const recommendations = async (trackId: redux.ItemId): Promise<Recommendations> => {
	const results = await Promise.allSettled([similarTracks(trackId), trackRadio(trackId)]);
	const lists = results.map((r) => (r.status === "fulfilled" ? r.value : []));
	const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason)] : []));

	const ids: string[] = [];
	const seen = new Set<string>([String(trackId)]);
	for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
		for (const list of lists) {
			const id = list[i];
			if (id !== undefined && !seen.has(id)) {
				seen.add(id);
				ids.push(id);
			}
		}
	}
	return { ids, errors };
};
