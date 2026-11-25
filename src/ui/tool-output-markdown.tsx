/** Render Markdown output only when it contains a Mermaid fence. */
import type { MarkdownRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import { createMarkdownLinkProps } from "./markdown-links.ts";
import { createMermaidBlockRenderer } from "./mermaid-renderer.ts";
import { colors, getMarkdownStyle, getThemeRevision } from "./theme.ts";

export function ToolOutputMarkdown(props: { id: string; content: string }) {
	let markdown: MarkdownRenderable | undefined;
	const renderMermaid = createMermaidBlockRenderer(() => markdown);
	const links = createMarkdownLinkProps(() => markdown);
	createEffect(() => {
		getThemeRevision();
		if (markdown) markdown.syntaxStyle = getMarkdownStyle();
	});
	createEffect(() => {
		const value = props.content;
		if (markdown) {
			if (!markdown.streaming) markdown.streaming = true;
			markdown.content = value;
		}
	});
	const finalize = function (this: MarkdownRenderable) {
		if (!this.streaming) return;
		queueMicrotask(() => {
			if (!this.isDestroyed) this.streaming = false;
		});
	};
	return <markdown {...links} id={props.id} ref={(value) => { markdown = value; }}
		syntaxStyle={getMarkdownStyle()} fg={colors.text}
		streaming conceal renderBlock={renderMermaid}
		minHeight={1} flexShrink={0} renderAfter={finalize}
		tableOptions={{ style: "columns", wrapMode: "word", selectable: true }} />;
}
