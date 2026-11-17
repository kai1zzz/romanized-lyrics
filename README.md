# RomajiLyrics para TidaLuna

Plugin de [TidaLuna](https://github.com/Inrixia/TidaLuna) que romaniza las letras de Tidal:

- **Japonés → romaji** con [kuromoji](https://github.com/takuyaa/kuromoji.js) (lee los kanji) + [wanakana](https://github.com/WaniKani/WanaKana). La primera vez se descarga el diccionario (~17 MB) desde jsDelivr y se guarda en `%APPDATA%\TIDAL\luna-romaji-lyrics`.
- **Coreano → romanización revisada**, con las reglas de pronunciación habituales (enlace, nasalización, ㄹ, aspiración).
- **Chino → pinyin** con tonos, con [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (resuelve caracteres con varias lecturas por contexto).

Modos (ajustes del plugin):

- **Debajo del original** (por defecto): cada línea muestra su romanización en pequeño justo debajo.
- **Solo romanización**: la letra entera (también la sincronizada) se reemplaza por la romanización.

Ejemplos:

| Original | Romanización |
| --- | --- |
| 君はずるい、ずるい人だ、もう | kimi wa zurui, zurui hito da, mou |
| わがままな君の中で綺麗に腐った罰 | wagamama na kimi no naka de kirei ni kusatta bachi |
| 감사합니다 / 많이 보고 싶어 | gamsahamnida / mani bogo sipeo |
| 月亮代表我的心 | yuè liàng dài biǎo wǒ de xīn |

## Instalación (modo desarrollo)

1. Instala TidaLuna (instalador en las releases de https://github.com/Inrixia/TidaLuna).
2. En esta carpeta:

   ```bash
   npx pnpm@10 install
   ```

   ```bash
   npx pnpm@10 run watch
   ```

3. Abre Tidal → **Luna Settings** → **Plugin Store** → tienda **DEV** → instala **@luna/romaji-lyrics**.
4. Pon una canción japonesa y abre la letra. El modo se cambia en los ajustes del plugin.

Mientras `watch` esté corriendo, cualquier cambio en `plugins/RomajiLyrics/src` se recarga en Tidal.

## Desarrollo

- `npx pnpm@10 run test`: prueba la conversión a romaji con frases de ejemplo (sin Tidal).
- `npx pnpm@10 run build`: genera `dist/` (el plugin `luna.romaji-lyrics.mjs` + `store.json`).
- Si el proyecto está en una ruta muy larga y esbuild no arranca (`spawn ... esbuild.exe ENOENT`), crea un `.npmrc` con `node-linker=hoisted` y reinstala.

### Archivos

- `src/lang.ts`: detecta el idioma de la canción (kana → japonés, hangul → coreano, solo hanzi → chino) y de cada línea.
- `src/ja.ts`: japonés → romaji (agrupa auxiliares/sufijos, partículas は/へ/を → wa/e/wo, vocales largas, puntuación, correcciones de lecturas comunes en canciones como 二人 → futari).
- `src/ko.ts`: coreano → romanización revisada.
- `src/zh.ts`: chino → pinyin.
- `src/romaji.native.ts`: corre en el proceso principal (Node) de Tidal; descarga/cachea el diccionario japonés y reparte cada línea a su conversor.
- `src/index.ts`: pide la letra de la canción actual, la convierte y, en la vista de letras, añade la romanización bajo cada línea (modo debajo) o cambia el texto de la línea por ella (modo solo romanización).
- `src/Settings.tsx`: selector de modo.

### Limitaciones

- Las lecturas de kanji no son perfectas (nombres propios, lecturas artísticas tipo 本気 → "maji"). Se pueden añadir correcciones en `READING_OVERRIDES` (`src/ja.ts`).
- El coreano sigue la romanización revisada oficial, que no marca la tensión de consonantes (없어 → eopseo, no "eopsseo").
- El modo "debajo" busca en pantalla el texto exacto de cada línea; si Tidal parte las líneas palabra a palabra, no las encontrará (usa "solo romanización").
- Las actualizaciones de Tidal/TidaLuna pueden romperlo (y al actualizarse Tidal hay que reinstalar TidaLuna).
