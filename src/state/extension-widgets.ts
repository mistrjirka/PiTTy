/** Display-only extension widgets. These never enter the conversation history. */
export const BTW_WIDGET_KEY = "mistrjirka.btw";
export const BTW_MIN_VISIBLE_MS = 30_000;

const completedBtwHeaders = new Set([
	"BTW · Answer", "BTW · Error", "BTW · Cancelled",
	"BTW · Output limit reached", "BTW · Tool request was not executed",
]);

/** A running answer stays visible. Help and completed results close on the next edit after 30 s. */
export function btwDismissOnTypingAt(key: string, lines: readonly string[], now: number): number | undefined {
	if (key !== BTW_WIDGET_KEY) return undefined;
	if (lines[0] === "BTW" || completedBtwHeaders.has(lines[0] ?? ""))
		return now + BTW_MIN_VISIBLE_MS;
	return undefined;
}

/** BTW answer bodies contain Markdown. The command guide is literal text. */
export function isBtwMarkdownWidget(key: string, lines: readonly string[]): boolean {
	return key === BTW_WIDGET_KEY && (lines[0]?.startsWith("BTW · ") ?? false);
}

export type ExtensionTextWidget = {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
	/** Earliest time this result can close after the user edits the main prompt. */
	dismissOnTypingAt?: number;
};

export type ExtensionWidgetState = {
	extensionWidgets?: Map<string, ExtensionTextWidget>;
};

const transitions = new WeakMap<ExtensionWidgetState, Map<string, ExtensionTextWidget>>();

/** Keep startup updates emitted before Pi acknowledges a session switch. */
export async function withExtensionWidgetTransition<T>(
	runtime: ExtensionWidgetState,
	operation: () => Promise<T>,
): Promise<T> {
	const before = new Map(runtime.extensionWidgets);
	transitions.set(runtime, before);
	try {
		return await operation();
	} finally {
		if (transitions.get(runtime) === before) transitions.delete(runtime);
	}
}

/** Remove the old session's widgets without discarding updates from its replacement. */
export function resetExtensionWidgets(runtime: ExtensionWidgetState): void {
	const before = transitions.get(runtime);
	if (!before) {
		runtime.extensionWidgets?.clear();
		return;
	}
	for (const [key, widget] of before) {
		if (runtime.extensionWidgets?.get(key) === widget)
			runtime.extensionWidgets.delete(key);
	}
}

export function reconcileExtensionWidgetSession(
	runtime: ExtensionWidgetState,
	previousSessionId: string | undefined,
	nextSessionId: string,
): void {
	// The first state response follows startup events and must preserve them.
	if (previousSessionId !== undefined && previousSessionId !== nextSessionId)
		resetExtensionWidgets(runtime);
	// Generic RPC widgets have no session identity. Extensions must cancel their
	// own old jobs; a late update cannot be identified as belonging to the old session.
}

/** Local widget dismissal. Does not send RPC commands or alter side-question state. */
export class TransientWidgetDismissController {
	constructor(
		private readonly onChange: (runtime: ExtensionWidgetState) => void,
		private readonly now: () => number = Date.now,
	) {}

	/** An edit before the minimum visibility period does not arm an automatic dismissal. */
	onUserTyped(runtime: ExtensionWidgetState): void {
		const widgets = runtime.extensionWidgets;
		if (!widgets) return;
		const now = this.now();
		for (const [key, widget] of widgets) {
			if (widget.dismissOnTypingAt === undefined || now < widget.dismissOnTypingAt) continue;
			if (widgets.get(key) === widget && widgets.delete(key)) this.onChange(runtime);
		}
	}
}
