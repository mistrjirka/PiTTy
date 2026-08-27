import { describe, expect, test } from "bun:test";
import { ConversationModel } from "../src/state/conversation.ts";
import { normalizeResultDetails } from "../src/state/result-diff.ts";
import type { PiEvent } from "../src/types.ts";

const event = (value: Record<string, unknown>): PiEvent => value;

describe("result diff normalization", () => {
	test("prefers structured readSeek entries and preserves their path", () => {
		const result = normalizeResultDetails({
			diff: "  1 old display\n+ 2 new display",
			diffData: {
				version: 1,
				entries: [
					{ kind: "context", oldLine: 1, newLine: 1, text: "same" },
					{ kind: "remove", oldLine: 2, text: "-literal" },
					{ kind: "add", newLine: 2, text: "+literal" },
					{ kind: "meta", text: "..." },
				],
			},
			readSeekValue: { path: "src/example.ts" },
		});

		expect(result).toEqual({
			diff: "  same\n- -literal\n+ +literal\n...",
			path: "src/example.ts",
		});
	});

	test("bounds unusually large structured diffs with an explicit marker", () => {
		const result = normalizeResultDetails({
			diffData: {
				entries: Array.from({ length: 3_000 }, (_, index) => ({
					kind: "add",
					newLine: index + 1,
					text: "x".repeat(10_000),
				})),
			},
		});

		expect(result.diff).toContain("… diff truncated …");
		expect(result.diff?.length ?? 0).toBeLessThan(101_000);
	});

	test("supports nested readSeek values when no top-level diff is present", () => {
		expect(
			normalizeResultDetails({
				readSeekValue: {
					path: "src/nested.ts",
					diffData: {
						entries: [{ kind: "add", newLine: 1, text: "nested" }],
					},
				},
			}),
		).toEqual({ diff: "+ nested", path: "src/nested.ts" });
	});

	test("bounds nested raw diff fallbacks", () => {
		const result = normalizeResultDetails({
			readSeekValue: { diff: "x".repeat(200_000) },
		});
		expect(result.diff).toContain("… diff truncated …");
		expect(result.diff?.length ?? 0).toBeLessThan(101_000);
	});

	test("uses normalized structured results in the live conversation", () => {
		const model = new ConversationModel();
		model.apply(
			event({
				type: "tool_execution_start",
				toolCallId: "readseek-write",
				toolName: "readSeek_write",
				args: { path: "src/example.ts" },
			}),
		);
		model.apply(
			event({
				type: "tool_execution_end",
				toolCallId: "readseek-write",
				toolName: "readSeek_write",
				isError: false,
				result: {
					content: [{ type: "text", text: "Updated src/example.ts" }],
					details: {
						diff: "  1 old display\n+ 2 new display",
						diffData: {
							version: 1,
							entries: [
								{ kind: "remove", oldLine: 1, text: "old" },
								{ kind: "add", newLine: 1, text: "new" },
							],
						},
						readSeekValue: { path: "src/example.ts" },
					},
				},
			}),
		);

		const item = model.items[0];
		expect(item?.kind).toBe("tool");
		expect(item?.kind === "tool" && item.diff).toBe("- old\n+ new");
		expect(item?.kind === "tool" && item.diffPath).toBe("src/example.ts");
	});
});
