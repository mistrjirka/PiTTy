/** Resolve clicks against the original Markdown span, not the wrapped terminal row. */
import { spawn } from "node:child_process";
import { type MarkdownInlineHook, type MarkdownRenderable, type MouseEvent } from "@opentui/core";

export function webLink(raw: string): string | undefined {
	if (/[\x00-\x20\x7f]/.test(raw)) return undefined;
	try {
		const url = new URL(raw);
		if ((url.protocol === "https:" || url.protocol === "http:") &&
			url.hostname && !url.username && !url.password) return raw;
	} catch { /* Not a web URL. */ }
	return undefined;
}

export const markdownLinkTargets: MarkdownInlineHook = (spans) =>
	spans.map((span) => {
		const url = span.link && webLink(span.link.url);
		return url ? { ...span, target: url } : span;
	});

/** Only called following a user click. Never pass Markdown content to a shell. */
function openWebLink(url: string): void {
	const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
	const child = spawn(command, [url], { detached: true, stdio: "ignore", shell: false });
	child.once("error", () => { /* Terminal-native link opening remains available. */ });
	child.unref();
}

/**
 * Keep the normal text-selection path. A drag, modifier-selection or click
 * outside the original link never opens a browser.
 */
export function createMarkdownLinkProps(
	markdown: () => MarkdownRenderable | undefined,
	open: (url: string) => void = openWebLink,
) {
	let pressed: { x: number; y: number; url: string } | undefined;
	const target = (event: MouseEvent) => {
		const raw = markdown()?.targetAt(event.x, event.y);
		return raw ? webLink(raw) : undefined;
	};
	return {
		inlineHook: markdownLinkTargets,
		// Only blocks which can contain web links or Markdown references need
		// the host-side span hook; leave ordinary prose on the native fast path.
		inlineHookFilter: ["http", "HTTP", "[", "<"],
		onMouseDown(event: MouseEvent) {
			pressed = undefined;
			if (event.button !== 0 || event.modifiers.shift || event.modifiers.alt) return;
			const url = target(event);
			if (url) pressed = { x: event.x, y: event.y, url };
		},
		onMouseDrag() { pressed = undefined; },
		onMouseUp(event: MouseEvent) {
			const start = pressed;
			pressed = undefined;
			if (!start || event.button !== 0 || event.modifiers.shift || event.modifiers.alt ||
				event.x !== start.x || event.y !== start.y || target(event) !== start.url) return;
			open(start.url);
			event.stopPropagation();
		},
	};
}
