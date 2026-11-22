import { redux } from "@luna/lib";

import { synthesize } from "./azure.native";

export type VoiceOptions = {
	engine: "windows" | "azure";
	/** Windows voice name */
	voiceName: string;
	azureKey: string;
	azureRegion: string;
	azureVoice: string;
	/** Music volume while talking, in % of the current volume */
	duckPercent: number;
	/** Voice loudness relative to the music volume, in % (100 = follows Tidal's volume) */
	voicePercent: number;
	/** Called when Azure fails and we fall back to the Windows voice */
	onAzureError?: (err: unknown) => void;
};

// ---------------------------------------------------------------------------
// Windows voices (Web Speech API)
// ---------------------------------------------------------------------------

/** Voices installed in Windows. They load asynchronously the first time. */
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

/** Returns a function that plays the prepared speech at `volume` (0-1) and resolves when it ends */
const prepareWindows = async (text: string, voiceName: string) => {
	const voice = await pickVoice(voiceName);
	return (volume: number) =>
		new Promise<void>((resolve) => {
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.volume = volume;
			if (voice) {
				utterance.voice = voice;
				utterance.lang = voice.lang;
			}
			utterance.rate = 1.05;
			utterance.onend = () => resolve();
			utterance.onerror = () => resolve();
			speechSynthesis.cancel();
			speechSynthesis.speak(utterance);
		});
};

// ---------------------------------------------------------------------------
// Azure voices (MP3 synthesized in the native process, played here)
// ---------------------------------------------------------------------------

let currentAudio: HTMLAudioElement | undefined;

const prepareAzure = async (text: string, o: VoiceOptions) => {
	const bytes = await synthesize(o.azureKey, o.azureRegion, o.azureVoice, text);
	const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }));
	return (volume: number) =>
		new Promise<void>((resolve) => {
			const audio = new Audio(url);
			audio.volume = volume;
			currentAudio = audio;
			const done = () => {
				URL.revokeObjectURL(url);
				if (currentAudio === audio) currentAudio = undefined;
				resolve();
			};
			audio.onended = done;
			audio.onerror = done;
			audio.onpause = done;
			audio.play().catch(done);
		});
};

// ---------------------------------------------------------------------------
// Speaking with music ducking
// ---------------------------------------------------------------------------

const getVolume = () => redux.store.getState().playbackControls.volume;
const isMuted = () => redux.store.getState().playbackControls.muted;

/**
 * Voice loudness (0-1) for a Tidal volume of 0-100, so the DJ is as loud as the music you set, not at full blast.
 * Volume sliders feel roughly logarithmic, so a slightly curved mapping matches the music better than a straight line.
 */
const voiceVolumeFor = (musicVolume: number, voicePercent: number) =>
	Math.max(0, Math.min(1, Math.pow(musicVolume / 100, 1.5) * (voicePercent / 100)));
const setVolume = (volume: number) => redux.actions["playbackControls/SET_VOLUME"]({ volume: Math.round(Math.max(0, Math.min(100, volume))) });

/** Smoothly move Tidal's volume to `to` over `ms` */
const fadeVolume = async (from: number, to: number, ms = 400) => {
	const steps = 8;
	for (let i = 1; i <= steps; i++) {
		setVolume(from + ((to - from) * i) / steps);
		await new Promise((r) => setTimeout(r, ms / steps));
	}
};

/** Words the voices mispronounce, spelled the way they should sound */
const PRONUNCIATIONS: [RegExp, string][] = [
	[/\bD\.?J\.?(s?)\b/gi, "diyéi$1"], // "DJ" -> di-yéi, not "de jota"
];
const pronounce = (text: string) => PRONUNCIATIONS.reduce((t, [re, sound]) => t.replace(re, sound), text);

let speaking: Promise<void> | undefined;

/**
 * Speaks `text`, lowering the music to `duckPercent`% of its volume while talking and bringing it back afterwards.
 * If the user moves the volume while the DJ talks, their new volume is kept.
 */
export const speak = async (text: string, o: VoiceOptions, stillWanted: () => boolean = () => true) => {
	text = pronounce(text);
	await speaking; // one announcement at a time
	speaking = (async () => {
		// Dropped while waiting its turn (e.g. you skipped the track it was about)
		if (!stillWanted()) return;
		// Prepare the audio first (Azure takes a moment) so the music ducks right when the voice starts
		let play: (volume: number) => Promise<void>;
		if (o.engine === "azure" && o.azureKey && o.azureRegion && o.azureVoice) {
			try {
				play = await prepareAzure(text, o);
			} catch (err) {
				o.onAzureError?.(err);
				play = await prepareWindows(text, o.voiceName);
			}
		} else play = await prepareWindows(text, o.voiceName);

		// Dropped while the audio was being prepared
		if (!stillWanted()) return;

		const original = getVolume();
		// Muted or at zero: the DJ stays quiet too
		if (isMuted() || original === 0) return;
		const voiceVolume = voiceVolumeFor(original, o.voicePercent);
		const ducked = (original * o.duckPercent) / 100;
		if (o.duckPercent < 100) await fadeVolume(original, ducked);

		await Promise.race([play(voiceVolume), new Promise((r) => setTimeout(r, 30000))]); // never leave the music ducked

		// Restore unless the user changed the volume meanwhile
		if (o.duckPercent < 100 && Math.abs(getVolume() - Math.round(ducked)) <= 1) await fadeVolume(getVolume(), original);
	})();
	return speaking;
};

export const stopSpeaking = () => {
	speechSynthesis.cancel();
	currentAudio?.pause();
};
