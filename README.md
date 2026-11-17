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

- Botón **DJ Kai** en la barra del reproductor: al pulsarlo el DJ toma el control al momento y va poniendo sus elecciones justo después de la canción actual (si no suena nada, empieza con una de tus favoritas). Pulsa otra vez para devolverte tu cola.
- Modo automático: cuando a la cola le quedan pocas canciones, añade al final canciones parecidas a la última de la cola, usando las *canciones similares* y la *radio de canción* de Tidal. No repite lo que ya sonó en la sesión.
- Mientras DJ Kai está activado, presenta con voz las canciones que elige, bajando un poco la música mientras habla. Fuera de DJ Kai no habla nunca (tampoco al abrir Tidal).
- Voz de Windows o de Azure AI Speech (voces neuronales, con tu clave).
- Comentarios con IA opcionales: Claude (Opus 5.5, Sonnet 5.5 o Haiku 5.5, con tu clave de Anthropic) escribe cada presentación; se piden por adelantado para que estén listas al empezar la canción, y si fallan o tardan se usan las frases normales.
- Saluda según la hora del día («¡Buenas noches! Soy tu DJ virtual personal…») y a veces lo menciona en las presentaciones.
- Aprende de lo que saltas: si dejas una de sus canciones en los primeros 30 segundos, no te la vuelve a poner, y tras 2 saltos del mismo artista deja de elegirlo (botón «Olvidar canciones saltadas» para empezar de cero). Todo local, sin IA.
- Comentarios a mitad de canción opcionales (apagados por defecto): cada N canciones dice algo breve hacia la mitad; con IA usa siempre Claude Haiku 5.5 para que apenas gaste.
- Ajustes: modo automático on/off, cuántas canciones mantener por delante, voz on/off, motor y voz, comentarios con IA, presentar todas las canciones, volumen de la música mientras habla.
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
