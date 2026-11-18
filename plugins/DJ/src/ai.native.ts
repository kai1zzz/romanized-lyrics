// Runs in Tidal's main (Node) process: writes the DJ's spoken intros with Claude.
import Anthropic from "@anthropic-ai/sdk";

import type { TrackInfo } from "./lines";

export type AiModel = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";

const SYSTEM = `Eres DJ Kai, un DJ virtual personal que presenta canciones en Tidal, en voz alta, como un locutor de radio cercano y con buen rollo.

Te pedirán uno de dos tipos de frase:
- PRESENTACIÓN: lo que dices justo cuando empieza una canción. Entre 12 y 35 palabras, una o dos frases. Di el título y el artista de forma natural (puedes acortar subtítulos largos entre paréntesis).
- COMENTARIO A MITAD: un apunte breve mientras la canción sigue sonando, sin interrumpir demasiado. Entre 8 y 22 palabras, una frase. No repitas la presentación; habla del artista, del estilo, del momento o invita a disfrutarla.

Reglas para ambos:
- Español neutro, tuteando.
- Puedes enlazar con la canción anterior, el ambiente, el género o la época. Varía el estilo: no empieces siempre igual ni repitas fórmulas.
- Te diré la hora local. De vez en cuando (no siempre) puedes aludir al momento del día, por ejemplo la noche, la mañana o la madrugada.
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

export type AiOptions = {
	/** "intro" when the track starts, "mid" for a short line halfway through */
	kind?: "intro" | "mid";
	/** Local time description, e.g. "son las 23:10 (de noche)" */
	time?: string;
};

/** Writes what the DJ says about `track`. Throws on API errors so the caller can fall back to the templates. */
export const aiIntro = async (apiKey: string, model: AiModel, track: TrackInfo, previous?: TrackInfo, opts: AiOptions = {}): Promise<string> => {
	const mid = opts.kind === "mid";
	const prompt = [
		opts.time ? `Hora local: ${opts.time}.` : undefined,
		mid ? `Canción que está sonando ahora (va por la mitad): ${describe(track)}.` : `Canción que empieza ahora: ${describe(track)}.`,
		mid ? undefined : previous ? `La eligió el DJ porque se parece a la anterior: ${describe(previous)}.` : "Es la primera canción que presentas.",
		mid ? "Escribe un COMENTARIO A MITAD." : "Escribe la PRESENTACIÓN.",
	]
		.filter(Boolean)
		.join("\n");
	return ask(apiKey, model, SYSTEM, prompt);
};

const FACT_SYSTEM = `Eres DJ Kai, un DJ virtual personal que habla en voz alta en Tidal, como un locutor de radio cercano.

Mientras suena una canción cuentas UN dato curioso sobre la canción o sobre el artista, tomado de las fuentes que te paso (Wikipedia y la biografía de Tidal).

Reglas:
- Usa SOLO información que aparezca en las fuentes. No añadas nada de tu memoria, no adornes cifras ni fechas, no deduzcas.
- Elige lo más sorprendente o divertido: el origen del nombre, cómo se formó el grupo, de qué trata la canción, un récord, una colaboración inesperada, una anécdota de la grabación. Evita lo obvio (que es un cantante, su género musical, que tiene muchos fans).
- Prefiere datos sobre la canción si los hay; si no, sobre el artista.
- No repitas datos que ya contaste (te los paso).
- Si las fuentes no tienen nada interesante, o no está claro que hablen de este artista, responde exactamente: NADA
- Español neutro, tuteando. Entre 12 y 35 palabras. Varía el arranque: no empieces siempre con «¿Sabías que…?».
- Se va a leer con voz sintética: sin emojis, comillas, paréntesis, listas ni acotaciones.
- No menciones Wikipedia ni «las fuentes». Responde solo con la frase o con NADA.`;

/**
 * A curious fact about `track` taken only from `sources`. Returns "" when there's nothing worth saying.
 * Throws on API errors.
 */
export const aiFact = async (apiKey: string, model: AiModel, track: TrackInfo, sources: string, alreadyTold: string[]): Promise<string> => {
	if (!sources.trim()) return "";
	const prompt = [
		`Canción que está sonando: ${describe(track)}.`,
		alreadyTold.length ? `Datos que ya contaste antes (no los repitas):\n- ${alreadyTold.join("\n- ")}` : undefined,
		`Fuentes:\n${sources}`,
		"Escribe el dato curioso o NADA.",
	]
		.filter(Boolean)
		.join("\n\n");
	const text = await ask(apiKey, model, FACT_SYSTEM, prompt);
	return /^NADA\.?$/i.test(text) ? "" : text;
};

const ask = async (apiKey: string, model: AiModel, system: string, prompt: string): Promise<string> => {
	const response = await getClient(apiKey.trim())
		.beta.messages.create({
		model,
		max_tokens: 2048,
		system,
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

	if (response.stop_reason === "refusal") throw new Error("Claude no quiso escribir esta frase");
	const text = response.content
		.flatMap((b) => (b.type === "text" ? [b.text] : []))
		.join(" ")
		.replace(/[*_#"“”]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) throw new Error("Respuesta vacía de Claude");
	return text;
};
