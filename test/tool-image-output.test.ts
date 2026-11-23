import { expect, test } from "bun:test";
import { ConversationModel, initialItems } from "../src/state/conversation.ts";
import { toolOutput, toolResultImages } from "../src/state/conversation-shared.ts";
import { sessionToolCalls } from "../src/state/conversation-history.ts";
import { prepareToolImage } from "../src/ui/tool-image-previews.tsx";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const mixed = { content: [
	{ type: "text", text: "Read image file [image/png]" },
	{ type: "image", mimeType: "image/png", data: png },
] };
const message = { role: "toolResult", toolCallId: "picture", toolName: "read",
	...mixed, timestamp: 100 };

test("image tool results retain binary separately, never leak base64 into text", () => {
	expect(toolOutput(mixed)).toBe("Read image file [image/png]");
	expect(toolOutput({ content: [mixed.content[1]] })).toBe("");
	expect(toolResultImages(mixed)).toEqual([{ mimeType: "image/png", data: png }]);
	expect(prepareToolImage(toolResultImages(mixed)[0]!)?.width).toBe(1);
});

test("original image is recovered from a saved conversation and a live tool result", () => {
	const [restored] = initialItems([message]);
	expect(restored).toMatchObject({ kind: "tool", name: "read",
		output: "Read image file [image/png]", images: [{ mimeType: "image/png" }] });
	if (restored?.kind === "tool") expect(restored.images?.[0]?.data).toBe(png);
	const model = new ConversationModel();
	model.apply({ type: "tool_execution_start", toolName: "read",
		toolCallId: "picture", args: { path: "/tmp/sample.png" } });
	model.apply({ type: "tool_execution_end", toolCallId: "picture",
		result: mixed, isError: false });
	const actual = model.items.find((item) => item.kind === "tool");
	expect(actual).toMatchObject({ kind: "tool", status: "done",
		output: "Read image file [image/png]", images: [{ data: png }] });
	expect(sessionToolCalls([message]).get("picture")?.images).toEqual([
		{ mimeType: "image/png", data: png },
	]);
});

test("malformed and unsupported image blocks fail closed without text leakage", () => {
	for (const block of [
		{ type: "image", mimeType: "image/bmp", data: png },
		{ type: "image", mimeType: "image/png", data: "!!!!!!!!" },
		{ type: "image", mimeType: "image/png", data: png.slice(1) },
		{ type: "image", mimeType: "image/png", data: "A".repeat(8 * 1024 * 1024 + 4) },
	]) {
		const result = { content: [{ type: "text", text: "Image attached" }, block] };
		expect(toolResultImages(result)).toHaveLength(0);
		expect(toolOutput(result)).toBe("Image attached");
	}
	expect(toolResultImages({ content: null })).toEqual([]);
	expect(prepareToolImage({ mimeType: "image/jpeg", data: png })).toBeUndefined();
});


test("image attachments are bounded and do not add fake text output", () => {
	const result = { content: Array.from({ length: 7 }, () =>
		({ type: "image", mimeType: "image/png", data: png })) };
	expect(toolResultImages(result)).toHaveLength(4);
	expect(toolOutput(result)).toBe("");
});
