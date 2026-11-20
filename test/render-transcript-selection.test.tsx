import { describe, expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import type { ConversationItem } from "../src/types.ts";
import { attachTranscriptSelectionCache } from "../src/app.tsx";

import { mount } from "./render-helpers/mount.tsx";

describe("duration and sidebar repaint regressions", () => {
	test("transcript selection copy survives streaming mutations", async () => {
		const upper: ConversationItem = {
			kind: "assistant",
			id: "stale-upper",
			text: "UPPERFILLERALPHA",
			thinking: "",
			timestamp: 1,
			status: "done",
		};
		const [lower, setLower] = createSignal<ConversationItem>({
			kind: "assistant",
			id: "stale-lower",
			text: "LOWERORIGINALSTREAMING",
			thinking: "",
			timestamp: 2,
			status: "streaming",
		});
		const setup = await mount(() => (
			<scrollbox width="100%" height="100%" scrollY scrollX={false}>
				<MessageView item={upper} showThinking toolExpanded={false} />
				<MessageView item={lower} showThinking toolExpanded={false} />
			</scrollbox>
		));
		// No gate predicate: everything mounted here is transcript content and
		// the prompt editor is not mounted, so every finished selection is cached.
		const cache = attachTranscriptSelectionCache(setup.renderer);

		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const row = lines.findIndex((line) =>
			line.includes("LOWERORIGINALSTREAMING"),
		);
		expect(row).toBeGreaterThanOrEqual(0);
		const startX = lines[row]!.indexOf("LOWERORIGINALSTREAMING");
		await setup.mockMouse.drag(
			startX,
			row,
			startX + "LOWERORIGINALSTREAMING".length,
			row,
		);
		await setup.flush();

		const liveBefore = setup.renderer.getSelection()?.getSelectedText() ?? "";
		expect(liveBefore).toContain("LOWERORIGINALSTREAMING");
		const copiedBefore = cache.getCopyText();
		expect(copiedBefore).toContain("LOWERORIGINALSTREAMING");

		// A stream chunk mutates the selected buffer in place, then the final
		// render swaps the streaming Text node for the Markdown node.
		setLower((current) =>
			current.kind === "assistant"
				? { ...current, text: `${current.text} APPENDEDCHUNK` }
				: current,
		);
		await setup.flush();
		setLower((current) =>
			current.kind === "assistant"
				? { ...current, text: "FINALREPLACEMENTBETA", status: "done" }
				: current,
		);
		await setup.flush();

		// The copy path still yields the originally selected text …
		expect(cache.getCopyText()).toBe(copiedBefore);
		// … while the raw live query demonstrably resolves against the mutated
		// content, which is what Ctrl+C copied before the fix.
		const liveAfter = setup.renderer.getSelection()?.getSelectedText() ?? "";
		expect(liveAfter).not.toContain("LOWERORIGINALSTREAMING");

		// Clearing the cache falls back to the live query, and clearing the
		// selection behaves exactly as before (no text, no copy).
		cache.clear();
		expect(cache.getCopyText()).toBe(liveAfter);
		setup.renderer.clearSelection();
		cache.clear();
		expect(cache.getCopyText()).toBe("");
		cache.dispose();
	});

	test("non-transcript selections bypass the copy cache", async () => {
		const item: ConversationItem = {
			kind: "assistant",
			id: "gated",
			text: "GATEDTRANSCRIPTTEXT",
			thinking: "",
			timestamp: 1,
			status: "done",
		};
		const setup = await mount(() => (
			<MessageView item={item} showThinking toolExpanded={false} />
		));
		const cache = attachTranscriptSelectionCache(setup.renderer, () => false);
		const frame = setup.captureCharFrame();
		const lines = frame.split("\n");
		const row = lines.findIndex((line) => line.includes("GATEDTRANSCRIPTTEXT"));
		expect(row).toBeGreaterThanOrEqual(0);
		const startX = lines[row]!.indexOf("GATEDTRANSCRIPTTEXT");
		await setup.mockMouse.drag(
			startX,
			row,
			startX + "GATEDTRANSCRIPTTEXT".length,
			row,
		);
		await setup.flush();
		const live = setup.renderer.getSelection()?.getSelectedText() ?? "";
		expect(live).toContain("GATEDTRANSCRIPTTEXT");
		// Gated out (as the prompt editor is): the copy path falls back to the
		// live query.
		expect(cache.getCopyText()).toBe(live);
		cache.dispose();
	});
});
