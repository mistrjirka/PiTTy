/** Display-only extension widgets. These never enter the conversation history. */
export const BTW_HELP_WIDGET_KEY = "mistrjirka.btw";
export const BTW_HELP_MIN_VISIBLE_MS = 30_000;

/** Only the command guide is temporary. A live side-question answer is not. */
export function btwHelpDismissAt(key: string, lines: readonly string[], now: number): number | undefined {
	return key === BTW_HELP_WIDGET_KEY && lines[0] === "BTW" &&
		lines.some((line) => line.startsWith("/btw <question>"))
		? now + BTW_HELP_MIN_VISIBLE_MS : undefined;
}

export type ExtensionTextWidget = {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
	/** Earliest time this help can close after the user edits the main prompt. */
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

/** Local help dismissal. Does not send RPC commands or alter side-question state. */
export class TransientWidgetDismissController {
	private readonly timers = new Map<ExtensionTextWidget, ReturnType<typeof setTimeout>>();
	constructor(
		private readonly onChange: (runtime: ExtensionWidgetState) => void,
		private readonly now: () => number = Date.now,
		private readonly schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
	) {}

	/** Only call for a real editor content edit. Cursor moves and tab restoration do not count. */
	onUserTyped(runtime: ExtensionWidgetState): void {
		for (const widget of runtime.extensionWidgets?.values() ?? []) {
			const deadline = widget.dismissOnTypingAt;
			if (deadline === undefined || this.timers.has(widget)) continue;
			const closeIfStillCurrent = () => {
				this.timers.delete(widget);
				if (runtime.extensionWidgets?.get(widget.key) !== widget) return;
				if (runtime.extensionWidgets.delete(widget.key)) this.onChange(runtime);
			};
			const remaining = Math.max(0, deadline - this.now());
			if (remaining === 0) closeIfStillCurrent();
			else {
				const timer = this.schedule(closeIfStillCurrent, remaining);
				timer.unref?.();
				this.timers.set(widget, timer);
			}
		}
	}

	dispose(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
	}
}
