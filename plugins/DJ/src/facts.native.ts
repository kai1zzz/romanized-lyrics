// Runs in Tidal's main (Node) process: gathers real text about an artist / song from Wikipedia,
// so the DJ's "curious facts" come from a source instead of the model's memory.

const UA = "LunaDJ/1.0 (TidaLuna plugin; https://github.com/kai1zzz/romanized-lyrics)";
const MAX_CHARS = 5000;

const norm = (s: string) =>
	s
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const getJson = async <T>(url: string): Promise<T> => {
	const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
	if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
	return res.json() as Promise<T>;
};

/** Best matching page title for `query`, or undefined */
const searchTitle = async (lang: string, query: string): Promise<string | undefined> => {
	const json = await getJson<{ pages?: { title: string; description?: string | null }[] }>(
		`https://${lang}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=3`,
	);
	return json.pages?.[0]?.title;
};

/** Plain-text article (intro + body), trimmed */
const pageText = async (lang: string, title: string): Promise<string | undefined> => {
	const json = await getJson<{ query?: { pages?: Record<string, { extract?: string }> } }>(
		`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&titles=${encodeURIComponent(title)}`,
	);
	const page = Object.values(json.query?.pages ?? {})[0];
	const text = page?.extract?.replace(/\n{2,}/g, "\n").trim();
	return text ? text.slice(0, MAX_CHARS) : undefined;
};

const articleAbout = async (query: string, mustMention: string[]): Promise<{ title: string; text: string; lang: string } | undefined> => {
	for (const lang of ["es", "en"]) {
		try {
			const title = await searchTitle(lang, query);
			if (!title) continue;
			const text = await pageText(lang, title);
			if (!text) continue;
			// Make sure we landed on the right page: it has to mention what we searched for
			const haystack = norm(`${title} ${text.slice(0, 1500)}`);
			if (mustMention.every((m) => haystack.includes(norm(m)))) return { title, text, lang };
		} catch {
			// try the next language
		}
	}
	return undefined;
};

/** Wikipedia text about the song (if it has its own article) and about the artist */
export const wikipediaFacts = async (title: string, artist: string): Promise<string> => {
	const mainArtist = artist.split(/,| y | & | feat\.? /i)[0].trim();
	const [song, band] = await Promise.all([
		articleAbout(`${title} ${mainArtist}`, [title.split(/[([-]/)[0].trim(), mainArtist]),
		articleAbout(mainArtist, [mainArtist]),
	]);
	const parts: string[] = [];
	if (song) parts.push(`Wikipedia (${song.lang}) sobre la canción, «${song.title}»:\n${song.text}`);
	if (band && band.title !== song?.title) parts.push(`Wikipedia (${band.lang}) sobre ${mainArtist}, «${band.title}»:\n${band.text}`);
	return parts.join("\n\n");
};
