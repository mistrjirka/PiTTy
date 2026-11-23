/** Inline Mermaid diagrams for Markdown code fences. Runs locally, without a browser or shell. */
import {
	BoxRenderable, TextRenderable, createMarkdownCodeBlockRenderer,
	type MarkdownCodeBlock, type MarkdownOptions, type MarkdownRenderable,
} from "@opentui/core";
import { renderMermaidASCII } from "beautiful-mermaid";
import { cleanTerminalText } from "./message-format.tsx";
import { colors } from "./theme.ts";

const MAX_SOURCE_LENGTH = 6_000;
const MAX_SOURCE_LINES = 100;
const MAX_DIAGRAM_LENGTH = 20_000;
const MAX_DIAGRAM_ROWS = 75;
const MAX_DIAGRAM_COLUMNS = 160;

export function renderMermaidInTerminal(source: string): string | undefined {
	if (!source.trim() || source.length > MAX_SOURCE_LENGTH ||
		source.split("\n").length > MAX_SOURCE_LINES) return undefined;
	try {
		// The library has no browser or subprocess dependency. Disable ANSI
		// so source labels cannot inject escape sequences into the terminal.
		const output = cleanTerminalText(renderMermaidASCII(
			cleanTerminalText(source),
			{ colorMode: "none", paddingX: 2, paddingY: 1, boxBorderPadding: 1 },
		)).replace(/[ \t]+$/gm, "").trimEnd();
		const lines = output.split("\n");
		if (!output.trim() || output.length > MAX_DIAGRAM_LENGTH ||
			lines.length > MAX_DIAGRAM_ROWS ||
			lines.some((line) => line.length > MAX_DIAGRAM_COLUMNS)) return undefined;
		return output;
	} catch {
		// Show original Mermaid code for malformed or unsupported diagrams.
		return undefined;
	}
}

/** Detect fenced Mermaid in a tool result without parsing unrelated tool logs as Markdown. */
export function containsMermaidFence(output: string): boolean {
	if (output.length > 200_000 || !/mermaid/i.test(output)) return false;
	return /(?:^|\n)[ \t]{0,3}(?:`{3,}|~{3,})mermaid(?:[ \t]+[^\n]*)?\r?\n/i.test(output);
}

/** Called by OpenTUI only when a completed Mermaid code block changes. */
export function createMermaidBlockRenderer(
	parent: () => MarkdownRenderable | undefined,
): NonNullable<MarkdownOptions["renderBlock"]> {
	return createMarkdownCodeBlockRenderer({
		mermaid: (block: MarkdownCodeBlock) => {
			if (!block.closed) return undefined;
			const markdown = parent();
			if (!markdown) return undefined;
			const rendered = renderMermaidInTerminal(block.text);
			if (!rendered) return undefined;
			const ctx = markdown.ctx;
			const panel = new BoxRenderable(ctx, {
				id: `${markdown.id}-mermaid-${block.index}`,
				width: "100%", flexDirection: "column", flexShrink: 0,
				paddingLeft: 1, marginTop: 1, marginBottom: 1,
			});
			const diagram = new TextRenderable(ctx, {
				id: `${panel.id}-diagram`, content: rendered,
				fg: colors.text, wrapMode: "none", selectable: true, flexShrink: 0,
			});
			const source = new TextRenderable(ctx, {
				id: `${panel.id}-source`, content: cleanTerminalText(block.text),
				fg: colors.muted, wrapMode: "word", selectable: true,
				flexShrink: 0, visible: false,
			});
			const label = new TextRenderable(ctx, {
				id: `${panel.id}-toggle`, content: "Mermaid diagram · show source",
				fg: colors.cyan, wrapMode: "none", flexShrink: 0,
				onMouseDown(event) {
					event.preventDefault();
					event.stopPropagation();
					const showingSource = !source.visible;
					source.visible = showingSource;
					diagram.visible = !showingSource;
					label.content = showingSource
						? "Mermaid source · show diagram" : "Mermaid diagram · show source";
				},
			});
			panel.add(label);
			panel.add(diagram);
			panel.add(source);
			return panel;
		},
	})!;
}
