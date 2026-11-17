import React from "react";

import { ReactiveStore } from "@luna/core";
import { LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import { applyMode, applySmooth } from ".";

export type RomajiMode = "below" | "replace";

export const settings = await ReactiveStore.getPluginStorage("RomajiLyrics", {
	mode: "below" as RomajiMode,
	smoothLyrics: true,
});

export const Settings = () => {
	const [mode, setMode] = React.useState<RomajiMode>(settings.mode);
	const [smooth, setSmooth] = React.useState(settings.smoothLyrics);
	return (
		<LunaSettings>
			<LunaSelectSetting
				title="Modo"
				desc="Japonés → romaji, coreano → romanización revisada, chino → pinyin. «Debajo» la añade bajo cada línea original; «Solo romanización» oculta el original y deja solo la letra romanizada."
				value={mode}
				onChange={(e: { target: { value: unknown } }) => {
					const next = e.target.value as RomajiMode;
					setMode((settings.mode = next));
					applyMode();
				}}
			>
				<LunaSelectItem value="below">Debajo del original</LunaSelectItem>
				<LunaSelectItem value="replace">Solo romanización</LunaSelectItem>
			</LunaSelectSetting>
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
