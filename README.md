# Romanized Lyrics para TidaLuna

Plugin de [TidaLuna](https://github.com/Inrixia/TidaLuna) que romaniza las letras de Tidal:

- **Japonés → romaji** con [kuromoji](https://github.com/takuyaa/kuromoji.js) (lee los kanji) + [wanakana](https://github.com/WaniKani/WanaKana). La primera vez se descarga el diccionario (~17 MB) desde jsDelivr y se guarda en `%APPDATA%\TIDAL\luna-romaji-lyrics`.
- **Coreano → romanización revisada**, con las reglas de pronunciación habituales (enlace, nasalización, ㄹ, aspiración).
- **Chino → pinyin** con tonos, con [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (resuelve caracteres con varias lecturas por contexto).

Ajuste «Cómo mostrar la letra»:

- **Original + romanización** (por defecto): cada línea muestra su romanización en pequeño justo debajo.
- **Solo romanización**: la letra original se oculta y queda solo la romanizada, a tamaño normal.

Ejemplos:

| Original | Romanización |
| --- | --- |
| 君はずるい、ずるい人だ、もう | kimi wa zurui, zurui hito da, mou |
| わがままな君の中で綺麗に腐った罰 | wagamama na kimi no naka de kirei ni kusatta bachi |
| 감사합니다 / 많이 보고 싶어 | gamsahamnida / mani bogo sipeo |
| 月亮代表我的心 | yuè liàng dài biǎo wǒ de xīn |

# DJ para TidaLuna

Segundo plugin de esta tienda (`plugins/DJ`), **@kai1zzz/dj**: un DJ personal.

- Cuando a la cola le quedan pocas canciones, añade al final canciones parecidas a la última de la cola, usando las *canciones similares* y la *radio de canción* de Tidal. No repite lo que ya sonó en la sesión.
- Presenta con voz las canciones que elige («Si te gustó X, esta te va a encantar: Y, de Z»), con una voz de Windows, bajando un poco la música mientras habla.
- Ajustes: activar/desactivar, cuántas canciones mantener por delante, voz on/off, qué voz, presentar todas las canciones, volumen de la música mientras habla.
- No hace nada con la repetición activada (la cola ya se repite sola).

## Instalar desde la tienda

En TidaLuna → **Plugin Store**, añade la tienda:

```
https://github.com/kai1zzz/romanized-lyrics/releases/download/latest/store.json
```

## Instalación (modo desarrollo)

1. Instala TidaLuna (instalador en las releases de https://github.com/Inrixia/TidaLuna).
2. En esta carpeta:

   ```bash
   npx pnpm@10 install
   ```

   ```bash
   npx pnpm@10 run watch
   ```

3. Abre Tidal → **Luna Settings** → **Plugin Store** → tienda **DEV** → instala **@kai1zzz/romanized-lyrics**.
4. Pon una canción japonesa y abre la letra. El modo se cambia en los ajustes del plugin.

Mientras `watch` esté corriendo, cualquier cambio en `plugins/RomajiLyrics/src` se recarga en Tidal.

## Desarrollo

- `npx pnpm@10 run test`: prueba la conversión a romaji con frases de ejemplo (sin Tidal).
- `npx pnpm@10 run build`: genera `dist/` (el plugin `kai1zzz.romanized-lyrics.mjs` + `store.json`).
- Si el proyecto está en una ruta muy larga y esbuild no arranca (`spawn ... esbuild.exe ENOENT`), crea un `.npmrc` con `node-linker=hoisted` y reinstala.

### Archivos

- `src/lang.ts`: detecta el idioma de la canción (kana → japonés, hangul → coreano, solo hanzi → chino) y de cada línea.
- `src/ja.ts`: japonés → romaji (agrupa auxiliares/sufijos, partículas は/へ/を → wa/e/wo, vocales largas, puntuación, correcciones de lecturas comunes en canciones como 二人 → futari).
- `src/ko.ts`: coreano → romanización revisada.
- `src/zh.ts`: chino → pinyin.
- `src/romaji.native.ts`: corre en el proceso principal (Node) de Tidal; descarga/cachea el diccionario japonés y reparte cada línea a su conversor.
- `src/index.ts`: pide la letra de la canción actual, la convierte y, en la vista de letras, añade la romanización bajo cada línea (modo «Original + romanización») o cambia el texto de la línea por ella (modo «Solo romanización»).
- `src/Settings.tsx`: selector de modo.

### Limitaciones

- Las lecturas de kanji no son perfectas (nombres propios, lecturas artísticas tipo 本気 → "maji"). Se pueden añadir correcciones en `READING_OVERRIDES` (`src/ja.ts`).
- El coreano sigue la romanización revisada oficial, que no marca la tensión de consonantes (없어 → eopseo, no "eopsseo").
- El modo «Original + romanización» busca en pantalla el texto exacto de cada línea; si Tidal parte las líneas palabra a palabra, no las encontrará (usa «Solo romanización»).
- Las actualizaciones de Tidal/TidaLuna pueden romperlo (y al actualizarse Tidal hay que reinstalar TidaLuna).
