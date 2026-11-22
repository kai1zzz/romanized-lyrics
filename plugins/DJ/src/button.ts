// "DJ Kai" button in Tidal's player bar, next to the play-queue button.
import { type LunaUnloads } from "@luna/core";
import { StyleTag } from "@luna/lib";

const BUTTON_ID = "kai-dj-button";
// Tidal tags its player controls with stable data-test attributes; try them in order
const ANCHORS = ['[data-test="play-queue-button"]', '[data-test="volume"]', '[data-test="repeat"]'];

// Vinyl record icon (inherits the text colour)
const ICON = `<svg class="kai-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`;

// The player bar styles every button in it as a round icon button: everything here is !important to stay a pill.
// --kai-h / --kai-bg / --kai-fg are copied from the neighbouring Tidal button at runtime so it blends in.
const CSS = `
#${BUTTON_ID} {
	all: unset;
	box-sizing: border-box !important;
	display: inline-flex !important;
	align-items: center !important;
	justify-content: center !important;
	gap: 6px !important;
	flex: 0 0 auto !important;
	width: auto !important;
	min-width: max-content !important;
	max-width: none !important;
	height: var(--kai-h, 36px) !important;
	padding: 0 14px 0 10px !important;
	margin: 0 6px !important;
	border-radius: 999px !important;
	background: var(--kai-bg, rgba(255, 255, 255, 0.08)) !important;
	color: var(--kai-fg, rgba(255, 255, 255, 0.85)) !important;
	font-family: inherit !important;
	font-size: 13px !important;
	font-weight: 600 !important;
	line-height: 1 !important;
	letter-spacing: 0.01em !important;
	white-space: nowrap !important;
	overflow: visible !important;
	cursor: pointer !important;
	user-select: none !important;
	transition: background 0.25s, color 0.25s, box-shadow 0.25s, transform 0.1s !important;
}
#${BUTTON_ID}:hover { color: #fff !important; filter: brightness(1.15); }
#${BUTTON_ID}:active { transform: scale(0.96); }
#${BUTTON_ID}:focus-visible { outline: 2px solid #7c4dff !important; outline-offset: 2px !important; }
#${BUTTON_ID} .kai-icon { width: 18px; height: 18px; flex: 0 0 auto; }
#${BUTTON_ID} .kai-label { display: inline-block; }
#${BUTTON_ID}.kai-on {
	background: linear-gradient(135deg, #7c4dff, #00bfa5) !important;
	color: #fff !important;
	box-shadow: 0 0 14px rgba(124, 77, 255, 0.45) !important;
}
#${BUTTON_ID}.kai-on .kai-icon { animation: kai-spin 3s linear infinite; }
#${BUTTON_ID}.kai-floating {
	position: fixed !important;
	right: 24px !important;
	bottom: 110px !important;
	z-index: 9999 !important;
	backdrop-filter: blur(8px);
}
/* Narrow window: round icon-only button, same size as Tidal's icon buttons */
#${BUTTON_ID}.kai-compact {
	width: var(--kai-h, 36px) !important;
	min-width: 0 !important;
	padding: 0 !important;
	gap: 0 !important;
	border-radius: 50% !important;
}
#${BUTTON_ID}.kai-compact .kai-label { display: none; }
/* Not even the round button fits: hide it (the DJ keeps working) until the window is wider */
#${BUTTON_ID}.kai-hidden { display: none !important; }
@keyframes kai-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { #${BUTTON_ID}.kai-on .kai-icon { animation: none; } }
`;

/** Copy size and colours from Tidal's own button so ours matches the bar */
const matchNeighbour = (button: HTMLElement, anchor: Element) => {
	const target = anchor.matches("button") ? anchor : (anchor.querySelector("button") ?? anchor);
	const cs = getComputedStyle(target);
	const h = (target as HTMLElement).offsetHeight;
	if (h >= 24 && h <= 56) button.style.setProperty("--kai-h", `${h}px`);
	const bg = cs.backgroundColor;
	if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") button.style.setProperty("--kai-bg", bg);
	if (cs.color) button.style.setProperty("--kai-fg", cs.color);
};

export const mountButton = (unloads: LunaUnloads, opts: { isOn: () => boolean; onClick: () => void; onChange: (cb: (on: boolean) => void) => () => void }) => {
	new StyleTag("KaiDJButton", unloads, CSS);

	const button = document.createElement("button");
	button.id = BUTTON_ID;
	button.type = "button";
	button.innerHTML = `${ICON}<span class="kai-label">DJ Kai</span>`;
	button.addEventListener("click", (e) => {
		e.stopPropagation();
		opts.onClick();
	});

	const render = (on: boolean) => {
		button.classList.toggle("kai-on", on);
		button.title = on ? "DJ Kai está pinchando. Pulsa para parar." : "DJ Kai: deja que el DJ elija lo siguiente";
		button.setAttribute("aria-pressed", String(on));
	};
	render(opts.isOn());
	unloads.add(opts.onChange(render) as () => void);

	// Keep the button in the player bar (Tidal re-renders it when switching views)
	let floatingTimer: ReturnType<typeof setTimeout> | undefined;
	const place = () => {
		if (button.isConnected && !button.classList.contains("kai-floating")) return;
		for (const selector of ANCHORS) {
			const anchor = document.querySelector(selector);
			if (anchor?.parentElement) {
				button.classList.remove("kai-floating");
				anchor.parentElement.insertBefore(button, anchor);
				matchNeighbour(button, anchor);
				return;
			}
		}
		// No anchor found (Tidal changed its layout): float it above the player after a while
		floatingTimer ??= setTimeout(() => {
			if (!button.isConnected) {
				button.classList.add("kai-floating");
				document.body.appendChild(button);
			}
		}, 8000);
	};

	// Three sizes depending on the room between the centre of the player (controls + progress bar + times)
	// and the next Tidal button: full pill, round icon-only, or hidden (the DJ keeps working, the button comes back
	// when there's room). Measured from the neighbour's position, which doesn't depend on our own size.
	let fullWidth = 110; // replaced by the real width the first time the pill is shown
	const fit = () => {
		if (!button.isConnected || button.classList.contains("kai-floating")) return;
		const next = button.nextElementSibling;
		if (!next) return;
		const rightEdge = next.getBoundingClientRect().left - 6; // our margin-right

		// Right edge of the centre: play controls, the progress bar and the box around it (with the times),
		// ignoring any box that's as wide as the whole bar
		let centre = 0;
		for (const el of [document.querySelector('[data-test="play-controls"]'), document.querySelector('[data-test="progress-bar"]')]) {
			for (const box of [el, el?.parentElement, el?.parentElement?.parentElement]) {
				const r = box?.getBoundingClientRect();
				if (r && r.width > 0 && r.right < rightEdge) centre = Math.max(centre, r.right);
			}
		}
		if (centre === 0) return;

		const isFull = !button.classList.contains("kai-compact") && !button.classList.contains("kai-hidden");
		if (isFull && button.offsetWidth > 0) fullWidth = button.offsetWidth;
		const compactWidth = button.offsetHeight || 36;
		const room = rightEdge - centre - 6; // our margin-left
		const mode = room >= fullWidth + 12 ? "full" : room >= compactWidth + 8 ? "compact" : "hidden";
		button.classList.toggle("kai-compact", mode === "compact");
		button.classList.toggle("kai-hidden", mode === "hidden");
	};
	window.addEventListener("resize", fit);
	const resizeObserver = new ResizeObserver(() => fit());
	resizeObserver.observe(document.body);

	let scheduled = false;
	const observer = new MutationObserver(() => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			place();
			fit();
		});
	});
	observer.observe(document.body, { childList: true, subtree: true });
	place();
	requestAnimationFrame(fit);

	unloads.add(() => {
		observer.disconnect();
		resizeObserver.disconnect();
		window.removeEventListener("resize", fit);
		clearTimeout(floatingTimer);
		button.remove();
	});
};
