import { describe, expect, test } from "bun:test";
import { alignLatestUserEntryIds, alignUserEntryIds, EntryIndex, forkPickerOptions } from "../src/tabs/entry-index.ts";

describe("conversation entry index", () => {
test("returns no fork options for empty input", () => {
expect(forkPickerOptions([])).toEqual([]);
});

test("hard-cuts long messages after flattening whitespace", () => {
const text = "a".repeat(81) + " trailing\nline";
expect(forkPickerOptions([{ entryId: "a", text }])[0]?.label).toBe(`1. ${"a".repeat(80)}`);
});

test("preserves duplicate texts in original order", () => {
expect(forkPickerOptions([
{ entryId: "a", text: "same" },
{ entryId: "b", text: "same" },
])).toEqual([
{ entryId: "a", label: "1. same", index: 0 },
{ entryId: "b", label: "2. same", index: 1 },
]);
});
	test("aligns duplicate texts sequentially", () => {
		const messages = [
			{ entryId: "a", text: "same" },
			{ entryId: "b", text: "same" },
		];
		expect(alignUserEntryIds([{ text: "same" }, { text: "same" }], messages)).toEqual(["a", "b"]);
	});

	test("skips compaction and unrelated persisted entries", () => {
		const messages = [
			{ entryId: "a", text: "before" },
			{ entryId: "b", text: "after" },
		];
		expect(alignUserEntryIds([{ text: "after" }], messages)).toEqual(["b"]);
	});

	test("fails closed when no matching entry exists", () => {
		expect(alignUserEntryIds([{ text: "missing" }], [{ entryId: "a", text: "other" }])).toEqual([undefined]);
	});

	test("refreshes incrementally from entries", () => {
		const index = new EntryIndex();
		index.applyEntries([{ id: "a", type: "message", message: { role: "user", content: "hello" } }], "a", [{ text: "hello" }]);
		expect(index.idFor(0)).toBe("a");
		expect(index.getLeafId()).toBe("a");
	});

	test("alignLatestUserEntryIds maps the visible tail to the newest entries", () => {
		const messages = [
			{ entryId: "old", text: "inspect layout" },
			{ entryId: "mid", text: "fix the diff" },
			{ entryId: "new", text: "release it" },
		];
		expect(alignLatestUserEntryIds([{ text: "release it" }], messages)).toEqual(["new"]);
		expect(alignLatestUserEntryIds([{ text: "fix the diff" }, { text: "release it" }], messages)).toEqual(["mid", "new"]);
	});

	test("alignLatestUserEntryIds prefers the newest occurrence of duplicated text", () => {
		const messages = [
			{ entryId: "old", text: "continue" },
			{ entryId: "mid", text: "review the diff" },
			{ entryId: "later", text: "continue" },
		];
		expect(alignLatestUserEntryIds([{ text: "continue" }], messages)).toEqual(["later"]);
	});

	test("alignLatestUserEntryIds keeps consecutive duplicates in order", () => {
		const messages = [
			{ entryId: "first", text: "run tests" },
			{ entryId: "second", text: "run tests" },
		];
		expect(alignLatestUserEntryIds([{ text: "run tests" }, { text: "run tests" }], messages)).toEqual(["first", "second"]);
	});

	test("alignLatestUserEntryIds fails closed on an unmatched tail", () => {
		const messages = [{ entryId: "a", text: "older prompt" }];
		expect(alignLatestUserEntryIds([{ text: "summarized prompt" }, { text: "older prompt" }], messages)).toEqual([undefined, "a"]);
		expect(alignLatestUserEntryIds([{ text: "missing" }], messages)).toEqual([undefined]);
	});
});
