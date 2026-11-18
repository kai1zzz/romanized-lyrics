import React from "react";

import { ReactiveStore } from "@luna/core";
import {
	LunaButton,
	LunaButtonSetting,
	LunaSetting,
	LunaNumberSetting,
	LunaSecureTextSetting,
	LunaSelectItem,
	LunaSelectSetting,
	LunaSettings,
	LunaSwitchSetting,
	LunaTextSetting,
} from "@luna/ui";

import { onEnabledChange, say, testAiComment } from ".";
import type { AiModel } from "./ai.native";
import { type AzureVoice, listVoices } from "./azure.native";
import { DJ_INTRO } from "./lines";
import { forgetSkips, skipStats } from "./skips";
import { getVoices, stopSpeaking } from "./voice";

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
	aiComments: false,
	anthropicKey: "",
	aiModel: "claude-opus-5-5" as AiModel,
	midComments: false,
	midEvery: 3,
});

type Change = { target: { value: unknown } };

/** A settings row with "Probar" and "Detener" side by side */
const TestButtons = (props: { title: string; desc: React.ReactNode; playing: boolean; onTest: () => void; onStop: () => void }) => (
	<LunaSetting title={props.title} desc={props.desc}>
		<div style={{ marginLeft: "auto", marginRight: 16, display: "flex", gap: 8, flexShrink: 0 }}>
			<LunaButton onClick={props.onTest}>Probar</LunaButton>
			<LunaButton onClick={props.onStop} disabled={!props.playing} color="error" variant="outlined">
				Detener
			</LunaButton>
		</div>
	</LunaSetting>
);

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
	const [aiComments, setAiComments] = React.useState(settings.aiComments);
	const [anthropicKey, setAnthropicKey] = React.useState(settings.anthropicKey);
	const [aiModel, setAiModel] = React.useState<AiModel>(settings.aiModel);
	const [aiStatus, setAiStatus] = React.useState("");
	const [midComments, setMidComments] = React.useState(settings.midComments);
	const [midEvery, setMidEvery] = React.useState(settings.midEvery);
	const [skips, setSkips] = React.useState(skipStats());

	// Which "Probar" button is playing: that one turns into "Detener"
	const [testing, setTesting] = React.useState<"none" | "voice" | "ai">("none");
	const testRef = React.useRef<"none" | "voice" | "ai">("none");
	const startTest = (which: "voice" | "ai") => {
		testRef.current = which;
		setTesting(which);
	};
	const endTest = (which: "voice" | "ai") => {
		if (testRef.current !== which) return;
		testRef.current = "none";
		setTesting("none");
	};
	const stopTest = () => {
		testRef.current = "none";
		setTesting("none");
		stopSpeaking(); // also brings the music volume back
	};
	React.useEffect(() => () => stopSpeaking(), []); // closing the settings stops a test too
	/** Voice sample when picking a voice: "Detener" next to "Probar voz" stops it */
	const previewVoice = (text: string) => {
		stopTest();
		startTest("voice");
		say(text).finally(() => endTest("voice"));
	};

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
						previewVoice("Hola, así sueno yo.");
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
							previewVoice(`${DJ_INTRO} Así sueno yo.`);
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

			<TestButtons
				title="Probar voz"
				desc="Reproduce una presentación de ejemplo con la voz elegida."
				playing={testing === "voice"}
				onStop={stopTest}
				onTest={() => {
					stopTest();
					startTest("voice");
					say(`${DJ_INTRO} Si te gustó esa, esta te va a encantar: Bohemian Rhapsody, de Queen.`).finally(() => endTest("voice"));
				}}
			/>

			<LunaSwitchSetting
				title="Comentarios con IA (Claude)"
				desc="En vez de frases fijas, Claude escribe cada presentación. Necesita una clave de API de Anthropic (de pago por uso). Si falla o tarda, usa las frases normales."
				checked={aiComments}
				onChange={(_: unknown, checked?: boolean) => setAiComments((settings.aiComments = checked ?? false))}
			/>
			{aiComments && (
				<>
					<LunaSecureTextSetting
						title="Clave de API de Anthropic"
						desc="console.anthropic.com → API Keys. Se guarda solo en este PC."
						// MUI's input types aren't installed in this repo (they come from Luna at runtime), so pass these untyped
						{...({
							value: anthropicKey,
							onChange: (e: Change) => setAnthropicKey((settings.anthropicKey = String(e.target.value).trim())),
						} as object)}
					/>
					<LunaSelectSetting
						title="Modelo"
						desc="Se usa para presentaciones y datos curiosos. Aprox. por frase: Opus 5.5 ~0,7 céntimos (datos ~2), Sonnet 5.5 ~0,3 (datos ~1), Haiku 5.5 ~0,02 (datos ~0,05)."
						value={aiModel}
						onChange={(e: Change) => setAiModel((settings.aiModel = e.target.value as AiModel))}
					>
						<LunaSelectItem value="claude-opus-5-5">Claude Opus 5.5</LunaSelectItem>
						<LunaSelectItem value="claude-sonnet-5-5">Claude Sonnet 5.5</LunaSelectItem>
						<LunaSelectItem value="claude-haiku-5-5">Claude Haiku 5.5</LunaSelectItem>
					</LunaSelectSetting>
					<TestButtons
						title="Probar comentario IA"
						desc={aiStatus || "Pide a Claude una presentación de la canción que suena y la dice en voz alta."}
						playing={testing === "ai"}
						onStop={stopTest}
						onTest={() => {
							stopTest();
							startTest("ai");
							setAiStatus("Escribiendo…");
							testAiComment(
								(text) => setAiStatus(`«${text}»`),
								() => testRef.current === "ai", // don't speak if you pressed Detener while it was writing
							)
								.catch((err: unknown) => setAiStatus(`Error: ${err instanceof Error ? err.message : String(err)}`))
								.finally(() => endTest("ai"));
						}}
					/>
				</>
			)}

			<LunaSwitchSetting
				title="Datos curiosos a mitad de canción"
				desc="De vez en cuando, a mitad de una canción (de más de 2 minutos), el DJ cuenta un dato curioso sobre la canción o el artista, sacado de Wikipedia y de la biografía de Tidal. Necesita los comentarios con IA y usa el mismo modelo. Si no encuentra nada interesante, no dice nada."
				checked={midComments}
				onChange={(_: unknown, checked?: boolean) => setMidComments((settings.midComments = checked ?? false))}
			/>
			{midComments && (
				<LunaNumberSetting
					title="Cada cuántas canciones"
					desc="2 = una de cada dos canciones; 5 = una de cada cinco. Más alto = gasta menos."
					min={1}
					max={10}
					value={midEvery}
					onNumber={(n: number) => setMidEvery((settings.midEvery = n))}
				/>
			)}
			<LunaButtonSetting
				title="Olvidar canciones saltadas"
				desc={`El DJ aprende de lo que saltas: ${skips.tracks} canciones que no volverá a poner y ${skips.artists} artistas que evita. Esto lo borra.`}
				onClick={() => {
					forgetSkips();
					setSkips(skipStats());
				}}
			>
				Olvidar
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
