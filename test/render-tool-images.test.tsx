import { expect, test } from "bun:test";
import { ImageRenderable, resolveImageRenderProtocol } from "@opentui/core";
import { createSignal } from "solid-js";
import { MessageView } from "../src/ui/message.tsx";
import type { ToolItem } from "../src/types.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function picture(): ToolItem {
	return { kind: "tool", id: "picture", name: "read", toolCallId: "picture",
		args: { path: "/tmp/image.png" }, output: "Read image file [image/png]",
		images: [{ mimeType: "image/png", data: png }],
		timestamp: 1, status: "done", isError: false };
}

test("image results use native terminal image rendering instead of base64 output", async () => {
	const [expanded, setExpanded] = createSignal(false);
	const setup = await mount(() => <MessageView
		item={picture()} showThinking toolExpanded={expanded}
		onToggleTool={() => setExpanded((value) => !value)} />, 96, 35);
	try {
		await setup.flush();
		let frame = setup.captureCharFrame();
		expect(frame).toContain("Image · PNG · 1×1");
		expect(frame).toContain("▸ details");
		expect(frame).not.toContain("iVBORw0K");
		const image = setup.renderer.root.findDescendantById("picture-images-0-pixels");
		expect(image).toBeInstanceOf(ImageRenderable);
		if (!(image instanceof ImageRenderable)) return;
		expect(image.protocol).toBe("auto");
		expect(resolveImageRenderProtocol("auto", null, false)).toBe("blocks");
		const capabilities = { kitty_graphics: true, sixel: false } as Parameters<typeof resolveImageRenderProtocol>[1];
		expect(resolveImageRenderProtocol("auto", capabilities, false)).toBe("kitty");
		const sixel = { kitty_graphics: false, sixel: true } as Parameters<typeof resolveImageRenderProtocol>[1];
		expect(resolveImageRenderProtocol("auto", sixel, true)).toBe("sixel");
		expect(resolveImageRenderProtocol("auto", sixel, false)).toBe("blocks");
		await image.loadPromise;
		expect(image.loadError).toBeFalsy();
		expect(image.height).toBe(9);
		const toggle = setup.renderer.root.findDescendantById("picture-tool-toggle");
		expect(toggle).toBeDefined();
		if (!toggle) return;
		await setup.mockMouse.click(toggle.x + 1, toggle.y);
		await setup.flush();
		frame = setup.captureCharFrame();
		expect(image.height).toBe(18);
		expect(frame).toContain("▾ hide");
		expect(frame).toContain("Image · PNG · 1×1");
		expect(frame).not.toContain(png);
	} finally { setup.renderer.destroy(); }
});

test("invalid images show a short error instead of a raw encoded payload", async () => {
	const bad: ToolItem = { ...picture(), id: "bad-picture",
		images: [{ mimeType: "image/png", data: "AAAAAAAA" }] };
	const setup = await mount(() => <MessageView item={bad}
		showThinking toolExpanded={false} />, 75, 20);
	try {
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Image preview unavailable");
		expect(frame).not.toContain("AAAAAAAA");
	} finally { setup.renderer.destroy(); }
});

test("multiple image results show one preview until details are expanded", async () => {
	const [expanded, setExpanded] = createSignal(false);
	const many: ToolItem = { ...picture(), id: "many-pictures",
		images: Array.from({ length: 3 }, () => ({ mimeType: "image/png", data: png })) };
	const setup = await mount(() => <MessageView item={many}
		showThinking toolExpanded={expanded}
		onToggleTool={() => setExpanded((current) => !current)} />, 95, 40);
	try {
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("+2 more images in details");
		expect(setup.renderer.root.findDescendantById("many-pictures-images-1-pixels")).toBeUndefined();
		const toggle = setup.renderer.root.findDescendantById("many-pictures-tool-toggle");
		expect(toggle).toBeDefined();
		if (!toggle) return;
		await setup.mockMouse.click(toggle.x + 1, toggle.y);
		await setup.flush();
		expect(setup.renderer.root.findDescendantById("many-pictures-images-1-pixels")).toBeDefined();
		expect(setup.captureCharFrame()).not.toContain("+2 more images");
	} finally { setup.renderer.destroy(); }
});
