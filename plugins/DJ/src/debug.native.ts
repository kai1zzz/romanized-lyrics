// Runs in Tidal's main process: a small local diagnostic log for how the DJ's picks land in the queue.
// %APPDATA%\TIDAL\luna-dj\queue-debug.jsonl — no keys, no personal data, just queue structure and track ids.
import { app } from "electron";
import { appendFile, mkdir, stat, writeFile } from "fs/promises";
import path from "path";

const MAX_BYTES = 512 * 1024;

export const debugLog = async (entry: Record<string, unknown>) => {
	const dir = path.join(app.getPath("userData"), "luna-dj");
	const file = path.join(dir, "queue-debug.jsonl");
	await mkdir(dir, { recursive: true });
	const size = await stat(file).then(
		(s) => s.size,
		() => 0,
	);
	const line = `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`;
	// Keep it small: start over when it gets big
	if (size > MAX_BYTES) await writeFile(file, line);
	else await appendFile(file, line);
};
