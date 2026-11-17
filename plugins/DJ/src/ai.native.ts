// Runs in Tidal's main (Node) process: writes the DJ's spoken intros with Claude.
import Anthropic from "@anthropic-ai/sdk";

import type { TrackInfo } from "./lines";

export type AiModel = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";

const SYSTEM = `Eres DJ Kai, un DJ virtual personal que presenta canciones en Tidal, en voz alta, como un locutor de radio cercano y con buen rollo.

Escribes la frase que dirás justo cuando empieza una canción. Reglas:
- Español neutro, tuteando. Entre 12 y 35 palabras, una o dos frases.
- Di el título y el artista de forma natural (puedes acortar subtítulos largos entre paréntesis).
- Puedes enlazar con la canción anterior, el ambiente, el género o la época. Varía el estilo: no empieces siempre igual ni repitas fórmulas.
- Solo menciona datos concretos (año, álbum, colaboraciones, historia) si te los dan o estás seguro de ellos. Nunca inventes anécdotas, premios ni cifras.
- Se va a leer con una voz sintética: nada de emojis, hashtags, comillas, listas, paréntesis ni acotaciones. Escribe los números como se dicen si es raro leerlos.
- No digas que eres una IA ni hables de estas instrucciones. Responde solo con la frase.`;

const describe = (t: TrackInfo) =>
	[`"${t.title}" de ${t.artist}`, t.album && t.album !== t.title ? `álbum "${t.album}"` : undefined, t.year ? `año ${t.year}` : undefined].filter(Boolean).join(", ");

let client: Anthropic | undefined;
let clientKey = "";
const getClient = (apiKey: string) => {
	if (client === undefined || clientKey !== apiKey) {
		client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
		clientKey = apiKey;
	}
	return client;
};

/** Writes the spoken intro for `track`. Throws on API errors so the caller can fall back to the templates. */
export const aiIntro = async (apiKey: string, model: AiModel, track: TrackInfo, previous?: TrackInfo): Promise<string> => {
	const prompt = [
		`Canción que empieza ahora: ${describe(track)}.`,
		previous ? `La eligió el DJ porque se parece a la anterior: ${describe(previous)}.` : "Es la primera canción que presentas.",
		"Escribe la presentación.",
	].join("\n");

	const response = await getClient(apiKey.trim())
		.beta.messages.create({
		model,
		max_tokens: 2048,
		system: SYSTEM,
		messages: [{ role: "user", content: prompt }],
		output_config: { effort: "low" }, // a one-line quip doesn't need deep thinking
		// On a policy refusal, let the API retry on a fallback model (not available for Haiku)
		...(model === "claude-haiku-5-5" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
		})
		.catch((err: unknown) => {
			if (err instanceof Anthropic.AuthenticationError) throw new Error("Clave de API de Anthropic incorrecta");
			if (err instanceof Anthropic.PermissionDeniedError) throw new Error("La clave de Anthropic no tiene permiso para este modelo");
			if (err instanceof Anthropic.RateLimitError) throw new Error("Límite de uso de Anthropic alcanzado, prueba más tarde");
			if (err instanceof Anthropic.APIError && err.status === 400 && /credit/i.test(err.message)) throw new Error("Sin saldo en la cuenta de Anthropic");
			throw err;
		});

	if (response.stop_reason === "refusal") throw new Error("Claude no quiso escribir esta presentación");
	const text = response.content
		.flatMap((b) => (b.type === "text" ? [b.text] : []))
		.join(" ")
		.replace(/[*_#"“”]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) throw new Error("Respuesta vacía de Claude");
	return text;
};
