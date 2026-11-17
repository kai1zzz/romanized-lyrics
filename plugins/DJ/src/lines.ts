// What the DJ says. Plain templates: no AI, no network.

export type TrackInfo = { title: string; artist: string; album?: string; year?: string };

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

export type DayPart = "madrugada" | "mañana" | "tarde" | "noche";

export const dayPart = (date = new Date()): DayPart => {
	const h = date.getHours();
	if (h < 6) return "madrugada";
	if (h < 13) return "mañana";
	if (h < 20) return "tarde";
	return "noche";
};

/** "Buenos días" / "Buenas tardes" / "Buenas noches" */
export const greeting = (part = dayPart()) => (part === "mañana" ? "¡Buenos días!" : part === "tarde" ? "¡Buenas tardes!" : "¡Buenas noches!");

/** e.g. "las 23:10, de noche" — passed to Claude so it can mention the moment of the day */
export const timeContext = (date = new Date()) =>
	`son las ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")} (${{ madrugada: "de madrugada", mañana: "por la mañana", tarde: "por la tarde", noche: "de noche" }[dayPart(date)]})`;

const PART_LINES: Record<DayPart, string[]> = {
	madrugada: ["Para los que seguimos despiertos", "A estas horas de la madrugada", "Para acompañar la madrugada"],
	mañana: ["Para empezar bien el día", "Para esta mañana", "Con energía de mañana"],
	tarde: ["Para esta tarde", "Para seguir la tarde", "Ponemos la tarde en marcha"],
	noche: ["Para esta noche", "Ya de noche", "Para cerrar el día"],
};

// ---------------------------------------------------------------------------
// Track intros
// ---------------------------------------------------------------------------

let lastTemplate = -1;
const pickTemplate = (templates: ((t: TrackInfo, seed?: TrackInfo) => string | undefined)[], t: TrackInfo, seed?: TrackInfo): string => {
	for (let tries = 0; tries < 10; tries++) {
		const i = Math.floor(Math.random() * templates.length);
		if (i === lastTemplate && templates.length > 1) continue;
		const text = templates[i](t, seed);
		if (text === undefined) continue;
		lastTemplate = i;
		return text;
	}
	return `Ahora suena ${t.title}, de ${t.artist}.`;
};

const TRACK_TEMPLATES: ((t: TrackInfo, seed?: TrackInfo) => string | undefined)[] = [
	(t) => `Ahora suena ${t.title}, de ${t.artist}.`,
	(t) => `Seguimos con ${t.artist}: ${t.title}.`,
	(t) => (t.year ? `Esta es ${t.title}, de ${t.artist}, del ${t.year}.` : undefined),
	(t, s) => (s ? `Si te gustó ${s.title}, esta te va a encantar: ${t.title}, de ${t.artist}.` : undefined),
	(t, s) => (s && s.artist !== t.artist ? `Después de ${s.artist}, cambiamos a ${t.artist} con ${t.title}.` : undefined),
	(t) => (t.album && t.album !== t.title ? `Del álbum ${t.album}, aquí tienes ${t.title}, de ${t.artist}.` : undefined),
	(t) => `${pick(["Vamos con", "Te dejo con", "Escucha esta:"])} ${t.title}, de ${t.artist}.`,
	(t) => `${pick(PART_LINES[dayPart()])}, ${t.title}, de ${t.artist}.`,
];

export const trackIntro = (t: TrackInfo, seed?: TrackInfo) => pickTemplate(TRACK_TEMPLATES, t, seed);

/** Short line in the middle of a track (template fallback when the AI isn't available) */
export const midComment = (t: TrackInfo) =>
	pick([
		`Seguimos con ${t.artist}. Si te está gustando, dale a favoritos.`,
		`Estás escuchando ${t.title}, de ${t.artist}.`,
		`${pick(PART_LINES[dayPart()])}, ${t.artist} sigue sonando.`,
	]);

/** How the DJ introduces itself */
export const DJ_INTRO = "Soy tu DJ virtual personal.";
