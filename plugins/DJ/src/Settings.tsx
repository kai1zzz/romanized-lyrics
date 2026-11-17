import React from "react";

import { ReactiveStore } from "@luna/core";
import {
	LunaButtonSetting,
	LunaNumberSetting,
	LunaSecureTextSetting,
	LunaSelectItem,
	LunaSelectSetting,
	LunaSettings,
	LunaSwitchSetting,
	LunaTextSetting,
} from "@luna/ui";

import { onEnabledChange, say } from ".";
import { type AzureVoice, listVoices } from "./azure.native";
import { DJ_INTRO } from "./lines";
import { getVoices } from "./voice";

export type VoiceEngine = "windows" | "azure";

export const settings = await ReactiveStore.getPluginStorage("KaiDJ", {
	enabled: true,
	ahead: 3,
	voice: true,
	engine: "windows" as VoiceEngine,
	voiceName: "",
	azureKey: "",
	azureRegion: "",
	azureVoice: "es-ES-AlvaroNeural",
	announceAll: false,
	duckPercent: 35,
});

type Change = { target: { value: unknown } };

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(settings.enabled);
	const [ahead, setAhead] = React.useState(settings.ahead);
	const [voice, setVoice] = React.useState(settings.voice);
	const [engine, setEngine] = React.useState<VoiceEngine>(settings.engine);
	const [voiceName, setVoiceName] = React.useState(settings.voiceName);
	const [azureKey, setAzureKey] = React.useState(settings.azureKey);
	const [azureRegion, setAzureRegion] = React.useState(settings.azureRegion);
	const [azureVoice, setAzureVoice] = React.useState(settings.azureVoice);
	const [announceAll, setAnnounceAll] = React.useState(settings.announceAll);
	const [duckPercent, setDuckPercent] = React.useState(settings.duckPercent);

	const [windowsVoices, setWindowsVoices] = React.useState<SpeechSynthesisVoice[]>([]);
	const [azureVoices, setAzureVoices] = React.useState<AzureVoice[]>([]);
	const [azureStatus, setAzureStatus] = React.useState("");

	React.useEffect(() => {
		getVoices().then((list) => {
			setWindowsVoices(list);
			if (!settings.voiceName) {
				const es = list.find((v) => v.lang.toLowerCase().startsWith("es")) ?? list[0];
				if (es) setVoiceName((settings.voiceName = es.name));
			}
		});
	}, []);

	// Load the Azure voice list once key + region look complete
	React.useEffect(() => {
		if (engine !== "azure" || azureKey.trim().length < 20 || azureRegion.trim().length < 3) return;
		setAzureStatus("Cargando voces…");
		const t = setTimeout(() => {
			listVoices(azureKey, azureRegion)
				.then((list) => {
					setAzureVoices(list);
					setAzureStatus(`Conectado: ${list.length} voces en español o multilingües.`);
				})
				.catch((err: unknown) => {
					setAzureVoices([]);
					setAzureStatus(err instanceof Error ? err.message : String(err));
				});
		}, 600);
		return () => clearTimeout(t);
	}, [engine, azureKey, azureRegion]);

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
				title="Motor de voz"
				desc="Windows: voces instaladas en el PC (gratis, más robóticas). Azure: voces neuronales de Microsoft (necesita tu clave; 500.000 caracteres al mes gratis)."
				value={engine}
				onChange={(e: Change) => setEngine((settings.engine = e.target.value as VoiceEngine))}
			>
				<LunaSelectItem value="windows">Windows</LunaSelectItem>
				<LunaSelectItem value="azure">Azure AI Speech</LunaSelectItem>
			</LunaSelectSetting>

			{engine === "windows" && (
				<LunaSelectSetting
					title="Voz de Windows"
					desc="Puedes añadir más en Configuración → Hora e idioma → Voz."
					value={windowsVoices.some((v) => v.name === voiceName) ? voiceName : ""}
					onChange={(e: Change) => {
						setVoiceName((settings.voiceName = String(e.target.value)));
						say("Hola, así sueno yo.");
					}}
				>
					{windowsVoices.map((v) => (
						<LunaSelectItem key={v.name} value={v.name}>
							{v.name} ({v.lang})
						</LunaSelectItem>
					))}
				</LunaSelectSetting>
			)}

			{engine === "azure" && (
				<>
					<LunaSecureTextSetting
						title="Clave de Azure (KEY 1)"
						desc="Recurso «Speech» de Azure → Keys and Endpoint. Se guarda solo en este PC."
						// MUI's input types aren't installed in this repo (they come from Luna at runtime), so pass these untyped
						{...({
							value: azureKey,
							onChange: (e: Change) => setAzureKey((settings.azureKey = String(e.target.value).trim())),
						} as object)}
					/>
					<LunaTextSetting
						title="Región"
						desc="La «Location/Region» del recurso, por ejemplo westeurope, eastus o brazilsouth."
						value={azureRegion}
						onChange={(e: Change) => setAzureRegion((settings.azureRegion = String(e.target.value).trim()))}
					/>
					<LunaSelectSetting
						title="Voz de Azure"
						desc={azureStatus || "Escribe la clave y la región para cargar las voces."}
						value={azureVoices.some((v) => v.name === azureVoice) ? azureVoice : ""}
						onChange={(e: Change) => {
							setAzureVoice((settings.azureVoice = String(e.target.value)));
							say(`${DJ_INTRO} Así sueno yo.`);
						}}
					>
						{azureVoices.map((v) => (
							<LunaSelectItem key={v.name} value={v.name}>
								{v.displayName} · {v.locale} · {v.gender === "Female" ? "mujer" : v.gender === "Male" ? "hombre" : v.gender}
								{v.multilingual ? " · multilingüe" : ""}
							</LunaSelectItem>
						))}
					</LunaSelectSetting>
				</>
			)}

			<LunaButtonSetting title="Probar voz" desc="Reproduce una presentación de ejemplo con la voz elegida." onClick={() => say(`${DJ_INTRO} Si te gustó esa, esta te va a encantar: Bohemian Rhapsody, de Queen.`)}>
				Probar
			</LunaButtonSetting>
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
