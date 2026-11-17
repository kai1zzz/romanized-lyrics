// What the DJ says. Plain templates: no AI, no network.

export type TrackInfo = { title: string; artist: string; album?: string; year?: string };

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

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
];

export const trackIntro = (t: TrackInfo, seed?: TrackInfo) => pickTemplate(TRACK_TEMPLATES, t, seed);

export const djHello = (current?: TrackInfo) =>
	current
		? `${pick(["¡Hola!", "¡Buenas!", "¿Qué tal?"])} Soy tu DJ. Cuando se acabe la cola sigo yo, con música parecida a ${current.title}, de ${current.artist}.`
		: `${pick(["¡Hola!", "¡Buenas!"])} Soy tu DJ. Pon una canción y yo me encargo del resto.`;
