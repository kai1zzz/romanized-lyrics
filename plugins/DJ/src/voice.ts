import { redux } from "@luna/lib";

/** Voices installed in Windows (Web Speech API). They load asynchronously the first time. */
export const getVoices = (): Promise<SpeechSynthesisVoice[]> =>
	new Promise((resolve) => {
		const voices = speechSynthesis.getVoices();
		if (voices.length > 0) return resolve(voices);
		const onChange = () => {
			speechSynthesis.removeEventListener("voiceschanged", onChange);
			resolve(speechSynthesis.getVoices());
		};
		speechSynthesis.addEventListener("voiceschanged", onChange);
		setTimeout(() => resolve(speechSynthesis.getVoices()), 2000);
	});

const pickVoice = async (name: string) => {
	const voices = await getVoices();
	return voices.find((v) => v.name === name) ?? voices.find((v) => v.lang.toLowerCase().startsWith("es")) ?? voices[0];
};

const getVolume = () => redux.store.getState().playbackControls.volume;
const setVolume = (volume: number) => redux.actions["playbackControls/SET_VOLUME"]({ volume: Math.round(Math.max(0, Math.min(100, volume))) });

/** Smoothly move Tidal's volume to `to` over `ms` */
const fadeVolume = async (from: number, to: number, ms = 400) => {
	const steps = 8;
	for (let i = 1; i <= steps; i++) {
		setVolume(from + ((to - from) * i) / steps);
		await new Promise((r) => setTimeout(r, ms / steps));
	}
};

let speaking: Promise<void> | undefined;

/**
 * Speaks `text`, lowering the music to `duckPercent`% of its volume while talking and bringing it back afterwards.
 * If the user moves the volume while the DJ talks, their new volume is kept.
 */
export const speak = async (text: string, { voiceName, duckPercent }: { voiceName: string; duckPercent: number }) => {
	await speaking; // one announcement at a time
	speaking = (async () => {
		const voice = await pickVoice(voiceName);
		const original = getVolume();
		const ducked = (original * duckPercent) / 100;
		if (duckPercent < 100) await fadeVolume(original, ducked);

		await new Promise<void>((resolve) => {
			const utterance = new SpeechSynthesisUtterance(text);
			if (voice) {
				utterance.voice = voice;
				utterance.lang = voice.lang;
			}
			utterance.rate = 1.05;
			utterance.onend = () => resolve();
			utterance.onerror = () => resolve();
			speechSynthesis.cancel();
			speechSynthesis.speak(utterance);
			setTimeout(resolve, 20000); // never leave the music ducked
		});

		// Restore unless the user changed the volume meanwhile
		if (duckPercent < 100 && Math.abs(getVolume() - Math.round(ducked)) <= 1) await fadeVolume(getVolume(), original);
	})();
	return speaking;
};

export const stopSpeaking = () => speechSynthesis.cancel();
