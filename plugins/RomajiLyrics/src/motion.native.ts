// Runs in Tidal's main process.
// Tidal turns off all lyric animations (smooth scroll, line scale/blur/fade) when the OS asks for reduced motion
// (Windows: Settings > Accessibility > Visual effects > Animation effects = off).
// This emulates `prefers-reduced-motion: no-preference` for Tidal's windows only, through the DevTools protocol.
import { BrowserWindow, type WebContents } from "electron";

const attachedByUs = new WeakSet<WebContents>();

export const setForceMotion = async (force: boolean): Promise<number> => {
	let applied = 0;
	for (const win of BrowserWindow.getAllWindows()) {
		const wc = win.webContents;
		try {
			if (force && !wc.debugger.isAttached()) {
				wc.debugger.attach("1.3");
				attachedByUs.add(wc);
			}
			if (!wc.debugger.isAttached()) continue;
			await wc.debugger.sendCommand("Emulation.setEmulatedMedia", {
				features: force ? [{ name: "prefers-reduced-motion", value: "no-preference" }] : [],
			});
			if (!force && attachedByUs.has(wc)) {
				wc.debugger.detach();
				attachedByUs.delete(wc);
			}
			applied++;
		} catch {
			// Window without a page, already closed, or another debugger refusing us: skip it
		}
	}
	return applied;
};
