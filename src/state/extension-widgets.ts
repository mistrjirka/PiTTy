/** Display-only extension widgets. These never enter the conversation history. */
export type ExtensionTextWidget = {
	key: string;
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
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
