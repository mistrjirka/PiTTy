import { describe, expect, test } from "bun:test";
import { alignUserEntryIds, EntryIndex, forkPickerOptions } from "../src/tabs/entry-index.ts";

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
});
