import React from "react";

import { ReactiveStore } from "@luna/core";
import { LunaNumberSetting, LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import { onEnabledChange } from ".";
import { getVoices, speak } from "./voice";

export const settings = await ReactiveStore.getPluginStorage("KaiDJ", {
	enabled: true,
	ahead: 3,
	voice: true,
	voiceName: "",
	announceAll: false,
	duckPercent: 35,
});

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(settings.enabled);
	const [ahead, setAhead] = React.useState(settings.ahead);
	const [voice, setVoice] = React.useState(settings.voice);
	const [voiceName, setVoiceName] = React.useState(settings.voiceName);
	const [announceAll, setAnnounceAll] = React.useState(settings.announceAll);
	const [duckPercent, setDuckPercent] = React.useState(settings.duckPercent);
	const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);

	React.useEffect(() => {
		getVoices().then((list) => {
			setVoices(list);
			if (!settings.voiceName) {
				const es = list.find((v) => v.lang.toLowerCase().startsWith("es")) ?? list[0];
				if (es) setVoiceName((settings.voiceName = es.name));
			}
		});
	}, []);

	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="DJ activo"
				desc="Cuando a la cola le quedan pocas canciones, el DJ añade al final canciones parecidas a lo que suena (canciones similares + radio de Tidal)."
				checked={enabled}
				onChange={(_: unknown, checked?: boolean) => {
					setEnabled((settings.enabled = checked ?? false));
					onEnabledChange();
				}}
			/>
			<LunaNumberSetting
				title="Canciones por delante"
				desc="Cuántas canciones mantiene preparadas en la cola."
				min={1}
				max={10}
				value={ahead}
				onNumber={(n: number) => setAhead((settings.ahead = n))}
			/>
			<LunaSwitchSetting
				title="Voz del DJ"
				desc="Presenta las canciones que elige el DJ, bajando un poco la música mientras habla."
				checked={voice}
				onChange={(_: unknown, checked?: boolean) => setVoice((settings.voice = checked ?? false))}
			/>
			<LunaSelectSetting
				title="Voz"
				desc="Voces instaladas en Windows. Puedes añadir más en Configuración → Hora e idioma → Voz."
				value={voices.some((v) => v.name === voiceName) ? voiceName : ""}
				onChange={(e: { target: { value: unknown } }) => {
					const name = String(e.target.value);
					setVoiceName((settings.voiceName = name));
					speak("Hola, así sueno yo.", { voiceName: name, duckPercent: settings.duckPercent });
				}}
			>
				{voices.map((v) => (
					<LunaSelectItem key={v.name} value={v.name}>
						{v.name} ({v.lang})
					</LunaSelectItem>
				))}
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Presentar todas las canciones"
				desc="Si está activado, la voz presenta también las canciones que no eligió el DJ."
				checked={announceAll}
				onChange={(_: unknown, checked?: boolean) => setAnnounceAll((settings.announceAll = checked ?? false))}
			/>
			<LunaNumberSetting
				title="Volumen de la música mientras habla (%)"
				desc="100 = no bajar la música."
				min={0}
				max={100}
				value={duckPercent}
				onNumber={(n: number) => setDuckPercent((settings.duckPercent = n))}
			/>
		</LunaSettings>
	);
};
