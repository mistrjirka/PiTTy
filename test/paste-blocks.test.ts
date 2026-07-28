import { describe, expect, test } from "bun:test";
import {
	createPromptPasteBlock,
	expandPromptPasteTokens,
	promptPasteDeletionRange,
	prunePromptPasteBlocks,
	shouldCollapsePromptPaste,
	stripCollapsedPromptPasteFragments,
} from "../src/state/paste-blocks.ts";

describe("paste blocks", () => {
	test("collapses large multiline pastes and leaves short input alone", () => {
		expect(shouldCollapsePromptPaste("short line")).toBe(false);
		expect(shouldCollapsePromptPaste("one\ntwo")).toBe(false);
		expect(shouldCollapsePromptPaste("one\ntwo\nthree")).toBe(true);
		expect(shouldCollapsePromptPaste("x".repeat(801))).toBe(true);
	});

	test("expands placeholder tokens back into full pasted text", () => {
		const first = createPromptPasteBlock("alpha\nbeta\ngamma", []);
		const second = createPromptPasteBlock("delta\nepsilon\nzeta", [first]);
		const visible = `before ${first.token} middle ${second.token} after`;
		expect(expandPromptPasteTokens(visible, [first, second])).toBe(
			"before alpha\nbeta\ngamma middle delta\nepsilon\nzeta after",
		);
	});

	test("drops hidden blocks once their placeholder is removed", () => {
		const first = createPromptPasteBlock("alpha\nbeta\ngamma", []);
		const second = createPromptPasteBlock("delta\nepsilon\nzeta", [first]);
		expect(prunePromptPasteBlocks(first.token, [first, second])).toEqual([
			first,
		]);
	});

	test("removes a collapsed paste atomically when its token is edited", () => {
		const block = createPromptPasteBlock("alpha\nbeta\ngamma", []);
		const partiallyDeleted = `before ${block.token.slice(0, -1)} after`;
		expect(stripCollapsedPromptPasteFragments(partiallyDeleted, [block])).toBe(
			"before  after",
		);
	});

	test("treats backspace and delete inside a token as deleting the whole token", () => {
		const block = createPromptPasteBlock("alpha\nbeta\ngamma", []);
		const text = `before ${block.token} after`;
		const start = text.indexOf(block.token);
		expect(
			promptPasteDeletionRange(text, [block], start + 4, "backward"),
		).toEqual({
			start,
			end: start + block.token.length,
		});
		expect(promptPasteDeletionRange(text, [block], start, "forward")).toEqual({
			start,
			end: start + block.token.length,
		});
	});
});
