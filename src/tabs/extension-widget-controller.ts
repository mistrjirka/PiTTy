import {
	btwHelpDismissAt,
	type ExtensionWidgetState,
} from "../state/extension-widgets.ts";

export type ExtensionWidgetRuntime = ExtensionWidgetState & { id: string };

/** Accepts text widgets from any extension without involving the modal request queue. */
export class ExtensionWidgetController {
	constructor(
		private readonly onChange: (runtime: ExtensionWidgetRuntime) => void,
		private readonly now: () => number = Date.now,
	) {}

	handle(value: unknown, runtime: ExtensionWidgetRuntime): boolean {
		if (!value || typeof value !== "object") return false;
		const event = value as Record<string, unknown>;
		if (event.type !== "extension_ui_request" || event.method !== "setWidget")
			return false;
		const { widgetKey: key, widgetLines: lines, widgetPlacement: placement } = event;
		// Consume malformed widget events as well, so they cannot become dialogs.
		if (typeof key !== "string" ||
			(placement !== undefined && placement !== "aboveEditor" && placement !== "belowEditor"))
			return true;
		if (lines === undefined) {
			if (runtime.extensionWidgets?.delete(key)) this.onChange(runtime);
			return true;
		}
		if (!Array.isArray(lines) || !lines.every((line: unknown) => typeof line === "string"))
			return true;
		const widgets = runtime.extensionWidgets ??= new Map();
		// Map.set replaces an entry in place, preserving extension insertion order.
		const dismissalAt = btwHelpDismissAt(key, lines, this.now());
		widgets.set(key, { key, lines: [...lines], placement: placement ?? "aboveEditor",
			...(dismissalAt === undefined ? {} : { dismissOnTypingAt: dismissalAt }),
		});
		this.onChange(runtime);
		return true;
	}
}
