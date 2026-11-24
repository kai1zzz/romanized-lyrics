import React from "react";

import { ReactiveStore } from "@luna/core";
import { LunaNumberSetting, LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import { applyMode, applySmooth } from ".";

export type RomajiMode = "below" | "replace";

export const settings = await ReactiveStore.getPluginStorage("RomajiLyrics", {
	mode: "below" as RomajiMode,
	smoothLyrics: true,
	karaoke: true,
	karaokeSpeed: 100,
});

export const Settings = () => {
	const [mode, setMode] = React.useState<RomajiMode>(settings.mode);
	const [smooth, setSmooth] = React.useState(settings.smoothLyrics);
	const [karaoke, setKaraoke] = React.useState(settings.karaoke);
	const [karaokeSpeed, setKaraokeSpeed] = React.useState(settings.karaokeSpeed);
	return (
		<LunaSettings>
			<LunaSelectSetting
				title="Cómo mostrar la letra"
				desc="Japonés → romaji, coreano → romanización revisada, chino → pinyin. «Original + romanización» añade la romanización en pequeño bajo cada línea; «Solo romanización» oculta la letra original."
				value={mode}
				onChange={(e: { target: { value: unknown } }) => {
					const next = e.target.value as RomajiMode;
					setMode((settings.mode = next));
					applyMode();
				}}
			>
				<LunaSelectItem value="below">Original + romanización</LunaSelectItem>
				<LunaSelectItem value="replace">Solo romanización</LunaSelectItem>
			</LunaSelectSetting>
			{mode === "below" && (
				<LunaSwitchSetting
					title="Efecto karaoke en la romanización"
					desc="La romanización de la línea que se está cantando se va iluminando de izquierda a derecha; el original se queda iluminado. Tidal sincroniza por línea, no por palabra, así que el relleno sigue el tiempo de cada línea."
					checked={karaoke}
					onChange={(_: unknown, checked?: boolean) => setKaraoke((settings.karaoke = checked ?? false))}
				/>
			)}
			{mode === "below" && karaoke && (
				<LunaNumberSetting
					title="Velocidad del karaoke (%)"
					desc="Se calcula el ritmo de cada canción automáticamente. Súbelo si el relleno va atrasado respecto a la voz, bájalo si va adelantado."
					min={50}
					max={200}
					value={karaokeSpeed}
					onNumber={(n: number) => setKaraokeSpeed((settings.karaokeSpeed = n))}
				/>
			)}
			<LunaSwitchSetting
				title="Animaciones suaves en las letras"
				desc="Tidal quita el desplazamiento suave y las transiciones de las letras si Windows tiene desactivados los «Efectos de animación». Esto las activa solo dentro de Tidal. Si no notas el cambio, cierra y vuelve a abrir la vista de letras."
				checked={smooth}
				onChange={(_: unknown, checked?: boolean) => {
					setSmooth((settings.smoothLyrics = checked ?? false));
					applySmooth();
				}}
			/>
		</LunaSettings>
	);
};
