// Runs in Tidal's main (Node) process: calls Azure AI Speech (no CORS issues, the key never touches the page).
// Docs: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech

export type AzureVoice = { name: string; displayName: string; locale: string; gender: string; multilingual: boolean };

const base = (region: string) => `https://${region.trim().toLowerCase()}.tts.speech.microsoft.com/cognitiveservices`;

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** Spanish voices + multilingual voices (those read English/Japanese titles inside a Spanish sentence well) */
export const listVoices = async (key: string, region: string): Promise<AzureVoice[]> => {
	const res = await fetch(`${base(region)}/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": key.trim() } });
	if (!res.ok) throw new Error(res.status === 401 ? "Clave o región de Azure incorrectas (401)" : `Azure respondió ${res.status} ${res.statusText}`);
	const voices = (await res.json()) as {
		ShortName: string;
		LocalName?: string;
		DisplayName: string;
		Locale: string;
		Gender: string;
		SecondaryLocaleList?: string[];
	}[];
	return voices
		.map((v) => ({
			name: v.ShortName,
			displayName: v.LocalName ?? v.DisplayName,
			locale: v.Locale,
			gender: v.Gender,
			multilingual: /Multilingual/i.test(v.ShortName) || (v.SecondaryLocaleList?.some((l) => l.startsWith("es")) ?? false),
		}))
		.filter((v) => v.locale.startsWith("es") || v.multilingual)
		.sort((a, b) => Number(b.locale.startsWith("es")) - Number(a.locale.startsWith("es")) || a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
};

/** Synthesizes `text` with `voice` and returns the MP3 bytes */
export const synthesize = async (key: string, region: string, voice: string, text: string): Promise<Uint8Array> => {
	const lang = /^[a-z]{2}-[A-Z]{2}/.exec(voice)?.[0] ?? "es-ES";
	// Multilingual voices: tell them the sentence is Spanish so they don't switch accent mid-sentence
	const body = /Multilingual/i.test(voice)
		? `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="es-ES"><voice name="${escapeXml(voice)}"><lang xml:lang="es-ES">${escapeXml(text)}</lang></voice></speak>`
		: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`;
	const res = await fetch(`${base(region)}/v1`, {
		method: "POST",
		headers: {
			"Ocp-Apim-Subscription-Key": key.trim(),
			"Content-Type": "application/ssml+xml",
			"X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
			"User-Agent": "luna-dj",
		},
		body,
	});
	if (!res.ok) throw new Error(res.status === 401 ? "Clave o región de Azure incorrectas (401)" : `Azure respondió ${res.status} ${res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
};
