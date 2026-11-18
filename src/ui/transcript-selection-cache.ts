/** Snapshot selected terminal text before live transcript mutations. */
import {
	CliRenderEvents,
	type CliRenderer,
	type Selection,
	type Renderable,
} from "@opentui/core";

export interface TranscriptSelectionCache {
	getCopyText: () => string;
	clear: () => void;
	dispose: () => void;
}

/**
 * Mitigation for stale transcript copies: opentui's `Selection` re-resolves
 * stored per-node coordinates against the nodes' current positions at
 * `getSelectedText()` time, so stream chunks or node swaps between mouse-up
 * and Ctrl+C yield text from earlier content. Snapshot the text when a mouse
 * selection finishes (the `selection` event fires after the final walk) and
 * prefer the snapshot on the copy path.
 */
export function attachTranscriptSelectionCache(
	renderer: Pick<CliRenderer, "getSelection" | "getSelectionContainer"> & {
		on(
			event: typeof CliRenderEvents.SELECTION,
			listener: (selection: Selection) => void,
		): void;
		off(
			event: typeof CliRenderEvents.SELECTION,
			listener: (selection: Selection) => void,
		): void;
	},
	isTranscriptContainer?: (container: Renderable | null) => boolean,
): TranscriptSelectionCache {
	let cached: string | null = null;
	const handleSelection = (selection: Selection) => {
		if (!selection || selection.isDragging) return;
		if (
			isTranscriptContainer &&
			!isTranscriptContainer(renderer.getSelectionContainer())
		) {
			return;
		}
		const text = selection.getSelectedText();
		cached = text ? text : null;
	};
	renderer.on(CliRenderEvents.SELECTION, handleSelection);
	return {
		getCopyText: () =>
			cached ?? renderer.getSelection()?.getSelectedText() ?? "",
		clear: () => {
			cached = null;
		},
		dispose: () => {
			renderer.off(CliRenderEvents.SELECTION, handleSelection);
		},
	};
}
