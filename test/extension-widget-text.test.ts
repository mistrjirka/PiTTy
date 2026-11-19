import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { extensionWidgetText } from "../src/ui/extension-widget-text.ts";

const text = (value: string) => extensionWidgetText(value).chunks.map((chunk) => chunk.text).join("");

describe("extension widget text", () => {
	test("keeps literal Markdown, blank lines, tabs and Unicode", () => {
		const value = "**literal**\n\n\tPříliš žluťoučký 界";
		expect(text(value)).toBe(value);
	});
	test("preserves RGB colors and bold then resets styling", () => {
		const chunks = extensionWidgetText("\x1b[1;38;2;22;211;238mstatus\x1b[0m done").chunks;
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.fg?.toInts()).toEqual([22, 211, 238, 255]);
		expect(chunks[0]?.attributes).toBe(TextAttributes.BOLD);
		expect(chunks[1]?.fg).toBeUndefined();
		expect(chunks[1]?.attributes).toBe(0);
	});
	test("preserves indexed foreground and background independently", () => {
		const chunks = extensionWidgetText("\x1b[91;48;5;25mfirst\x1b[39m second\x1b[49m third").chunks;
		expect(chunks[0]?.fg?.slot).toBe(9);
		expect(chunks[0]?.bg?.slot).toBe(25);
		expect(chunks[1]?.fg).toBeUndefined();
		expect(chunks[1]?.bg?.slot).toBe(25);
		expect(chunks[2]?.bg).toBeUndefined();
	});
	test("handles colon RGB and selective attribute reset", () => {
		const chunks = extensionWidgetText("\x1b[1;3;38:2::12:34:56mone\x1b[22mtwo\x1b[23mthree").chunks;
		expect(chunks[0]?.fg?.toInts()).toEqual([12, 34, 56, 255]);
		expect(chunks[1]?.attributes).toBe(TextAttributes.ITALIC);
		expect(chunks[2]?.attributes).toBe(0);
	});
	test("removes terminal controls while keeping their surrounding text", () => {
		expect(text("before\x1b]52;c;Zm9v\x07after\x1b[2J\x1b[?25l\x00")).toBe("beforeafter");
		expect(text("\x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe("link");
	});
	test("ignores incomplete or out-of-range color parameters", () => {
		expect(extensionWidgetText("\x1b[38;2;12;34mtext").chunks[0]?.fg).toBeUndefined();
		expect(extensionWidgetText("\x1b[48;2;999;1;2mtext").chunks[0]?.bg).toBeUndefined();
	});
});
