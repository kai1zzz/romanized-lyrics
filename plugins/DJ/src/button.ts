// "DJ Kai" button in Tidal's player bar, next to the play-queue button.
import { type LunaUnloads } from "@luna/core";
import { StyleTag } from "@luna/lib";

const BUTTON_ID = "kai-dj-button";
// Tidal tags its player controls with stable data-test attributes; try them in order
const ANCHORS = ['[data-test="play-queue-button"]', '[data-test="volume"]', '[data-test="repeat"]'];

const CSS = `
#${BUTTON_ID} {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 28px;
	padding: 0 12px;
	margin: 0 8px;
	border-radius: 999px;
	border: 1px solid rgba(255, 255, 255, 0.28);
	background: transparent;
	color: inherit;
	font-family: inherit;
	font-size: 12px;
	font-weight: 600;
	line-height: 1;
	letter-spacing: 0.02em;
	white-space: nowrap;
	cursor: pointer;
	transition: background 0.25s, border-color 0.25s, box-shadow 0.25s, transform 0.1s;
	flex-shrink: 0;
}
#${BUTTON_ID}:hover { border-color: rgba(255, 255, 255, 0.6); }
#${BUTTON_ID}:active { transform: scale(0.96); }
#${BUTTON_ID} .kai-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.35);
	transition: background 0.25s, box-shadow 0.25s;
}
#${BUTTON_ID}.kai-on {
	border-color: transparent;
	background: linear-gradient(135deg, #7c4dff, #00bfa5);
	color: #fff;
	box-shadow: 0 0 14px rgba(124, 77, 255, 0.45);
}
#${BUTTON_ID}.kai-on .kai-dot {
	background: #fff;
	box-shadow: 0 0 6px #fff;
	animation: kai-pulse 1.6s ease-in-out infinite;
}
#${BUTTON_ID}.kai-floating {
	position: fixed;
	right: 24px;
	bottom: 110px;
	z-index: 9999;
	background: rgba(20, 20, 24, 0.85);
	backdrop-filter: blur(8px);
}
@keyframes kai-pulse { 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { #${BUTTON_ID}.kai-on .kai-dot { animation: none; } }
`;

export const mountButton = (unloads: LunaUnloads, opts: { isOn: () => boolean; onClick: () => void; onChange: (cb: (on: boolean) => void) => () => void }) => {
	new StyleTag("KaiDJButton", unloads, CSS);

	const button = document.createElement("button");
	button.id = BUTTON_ID;
	button.type = "button";
	button.innerHTML = `<span class="kai-dot"></span><span>DJ Kai</span>`;
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

	let scheduled = false;
	const observer = new MutationObserver(() => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			place();
		});
	});
	observer.observe(document.body, { childList: true, subtree: true });
	place();

	unloads.add(() => {
		observer.disconnect();
		clearTimeout(floatingTimer);
		button.remove();
	});
};
