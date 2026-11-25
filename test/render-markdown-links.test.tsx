import { expect, test } from "bun:test";
import { MarkdownRenderable } from "@opentui/core";
import { createMarkdownLinkProps, webLink } from "../src/ui/markdown-links.ts";
import { MessageView } from "../src/ui/message.tsx";
import { getMarkdownStyle } from "../src/ui/theme.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

test("wrapped link fragments open the original complete URL", async () => {
	const url = "https://example.com/abcdefghijklmno/pqrstuvwxyz0123456789/abcdefghi?x=123&y=456";
	const opened: string[] = [];
	let markdown: MarkdownRenderable | undefined;
	const links = createMarkdownLinkProps(() => markdown, (value) => opened.push(value));
	const setup = await mount(() => <markdown {...links} ref={value => { markdown = value; }}
		content={`Before ${url} after.`} syntaxStyle={getMarkdownStyle()} conceal />, 35, 14);
	const lines = setup.captureCharFrame().split("\n");
	const firstRow = lines.findIndex(line => line.includes("https://example.com/"));
	const lastRow = lines.findIndex(line => line.includes("abcdefghi?"));
	expect(firstRow).toBeGreaterThanOrEqual(0);
	expect(lastRow).toBeGreaterThan(firstRow);
	const firstX = lines[firstRow]!.indexOf("https://");
	const lastX = lines[lastRow]!.indexOf("abcdefghi?");
	await setup.mockMouse.click(firstX, firstRow);
	await setup.mockMouse.click(lastX, lastRow);
	expect(opened).toEqual([url, url]);
	await setup.mockMouse.drag(firstX, firstRow, lastX + 3, lastRow);
	expect(opened).toEqual([url, url]);
	expect(setup.renderer.getSelection()?.getSelectedText()).toBeTruthy();
});

test("named Markdown link resolves to its URL and nonweb schemes cannot launch", async () => {
	const url = "https://example.com/full/path?q=hello%20world";
	let markdown: MarkdownRenderable | undefined;
	const opened: string[] = [];
	const links = createMarkdownLinkProps(() => markdown, (value) => opened.push(value));
	const setup = await mount(() => <markdown {...links} ref={value => { markdown = value; }}
		content={`[Open this](${url})\n\n[Local](file:///etc/passwd)`} syntaxStyle={getMarkdownStyle()} conceal />, 32, 12);
	const lines = setup.captureCharFrame().split("\n");
	const y = lines.findIndex(line => line.includes("Open this"));
	expect(y).toBeGreaterThanOrEqual(0);
	await setup.mockMouse.click(lines[y]!.indexOf("Open this"), y);
	expect(opened).toEqual([url]);
	expect(webLink("file:///etc/passwd")).toBeUndefined();
	expect(webLink("javascript:alert(1)")).toBeUndefined();
	expect(webLink("https://example.com/\nother")).toBeUndefined();
	expect(webLink("https://user:pass@example.com/")).toBeUndefined();
});

test("completed assistant messages retain full targets across wrapped rows", async () => {
	const url = "https://example.com/abcdefghijklmno/pqrstuvwxyz0123456789/abcdefghi";
	const setup = await mount(() => <MessageView item={{
		kind: "assistant", id: "wrapped-link", text: url, thinking: "", timestamp: 1, status: "done",
	}} showThinking toolExpanded={false} />, 35, 14);
	const markdown = setup.renderer.root.findDescendantById("wrapped-link-answer-markdown");
	expect(markdown).toBeInstanceOf(MarkdownRenderable);
	if (!(markdown instanceof MarkdownRenderable)) throw new Error("Markdown not mounted");
	const lines = setup.captureCharFrame().split("\n");
	for (const fragment of ["https://example.com/", "pqrstuvwxyz"]) {
		const row = lines.findIndex(line => line.includes(fragment));
		expect(row).toBeGreaterThanOrEqual(0);
		expect(markdown.targetAt(lines[row]!.indexOf(fragment), row)).toBe(url);
	}
});
