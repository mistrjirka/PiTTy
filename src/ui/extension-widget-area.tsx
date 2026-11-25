import type { MarkdownRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { isBtwMarkdownWidget, type ExtensionTextWidget } from "../state/extension-widgets.ts";
import { extensionWidgetText } from "./extension-widget-text.ts";
import { createMarkdownLinkProps } from "./markdown-links.ts";
import { createMermaidBlockRenderer } from "./mermaid-renderer.ts";
import { colors, getMarkdownStyle, getThemeRevision } from "./theme.ts";

export interface ExtensionWidgetAreaProps {
	widgets: readonly ExtensionTextWidget[];
	maxRows: number;
	id?: string;
	onContentRows?: (rows: number) => void;
}

function WidgetText(props: { widget: ExtensionTextWidget; id: string }) {
	let text: TextRenderable | undefined;
	createEffect(() => {
		const content = extensionWidgetText(props.widget.lines.join("\n"));
		// OpenTUI Solid stringifies StyledText in its content prop. The native
		// text setter preserves the styled chunks and their selection ranges.
		if (text) text.content = content;
	});
	return (
		<text id={props.id} ref={(value) => { text = value; }}
			fg={colors.text} wrapMode="word" selectable minHeight={1} flexShrink={0} />
	);
}

function WidgetMarkdown(props: { widget: ExtensionTextWidget; id: string }) {
	let markdown: MarkdownRenderable | undefined;
	const renderMermaid = createMermaidBlockRenderer(() => markdown);
	const links = createMarkdownLinkProps(() => markdown);
	createEffect(() => {
		getThemeRevision();
		if (markdown) markdown.syntaxStyle = getMarkdownStyle();
	});
	createEffect(() => {
		const content = props.widget.lines.join("\n");
		if (markdown) {
			if (!markdown.streaming) markdown.streaming = true;
			markdown.content = content;
		}
	});
	const finalize = function (this: MarkdownRenderable) {
		if (!this.streaming) return;
		queueMicrotask(() => {
			if (!this.isDestroyed) this.streaming = false;
		});
	};
	return <markdown {...links} id={props.id} ref={(value) => { markdown = value; }}
		syntaxStyle={getMarkdownStyle()} fg={colors.text} conceal streaming
		renderBlock={renderMermaid}
		minHeight={1} flexShrink={0} renderAfter={finalize}
		tableOptions={{ style: "columns", wrapMode: "word", selectable: true }} />;
}

/** BTW answers are Markdown. Other extension widgets retain their ANSI text styling. */
export function ExtensionWidgetArea(props: ExtensionWidgetAreaProps) {
	let scroll: ScrollBoxRenderable | undefined;
	const widgets = createMemo(() => new Map(
		props.widgets.filter((widget) => widget.lines.length > 0).map((widget) => [widget.key, widget]),
	));
	const keys = createMemo(() => [...widgets().keys()]);
	const [measuredRows, setMeasuredRows] = createSignal(0);
	const rows = () => keys().length === 0 ? 0 : measuredRows() || keys().reduce((total, key) =>
		total + widgets().get(key)!.lines.join("\n").split("\n").length, 0);
	const measure = (): void => {
		const target = scroll;
		// scrollHeight is floored by the current viewport and cannot detect shrinkage.
		target?.afterLayout(() => setMeasuredRows(target.getChildren().reduce(
			(total, child) => total + child.height, 0,
		)));
	};
	createEffect(() => { widgets(); measure(); });
	createEffect(() => props.onContentRows?.(rows()));

	return (
		<Show when={keys().length > 0}>
			<scrollbox id={props.id ?? "extension-widgets"}
				ref={(value) => { scroll = value; measure(); }}
				height={Math.min(props.maxRows, rows())} onSizeChange={measure}
				minHeight={0} flexShrink={1} focusable={false}
				scrollY scrollX={false} viewportCulling={true}
				backgroundColor={colors.panelSoft}
				contentOptions={{ paddingLeft: 2, paddingRight: 2 }}
				verticalScrollbarOptions={{
					showArrows: false,
					trackOptions: { foregroundColor: colors.borderStrong, backgroundColor: colors.panelSoft },
				}}
				onMouseScroll={(event) => { event.preventDefault(); event.stopPropagation(); }}>
				<For each={keys()}>
					{(key) => <Show
						when={isBtwMarkdownWidget(key, widgets().get(key)!.lines)}
						fallback={<WidgetText id={`${props.id ?? "extension-widgets"}-${key}`} widget={widgets().get(key)!} />}>
						<WidgetMarkdown id={`${props.id ?? "extension-widgets"}-${key}`} widget={widgets().get(key)!} />
					</Show>}
				</For>
			</scrollbox>
		</Show>
	);
}
