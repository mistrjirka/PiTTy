/** Shared keyboard shortcuts and navigation decisions, without renderer state. */
import type { KeyEvent } from "@opentui/core";

export type DetailToggleState = {
	toolsExpanded: boolean;
	thinkingExpanded: boolean;
	compactionExpanded?: boolean;
	hasExpandedToolOverride?: boolean;
	hasExpandedThinkingOverride?: boolean;
};

export type SettingsRoute =
	| "closed"
	| "root"
	| "providers"
	| "plugins"
	| "model"
	| "thinking"
	| "compaction"
	| "compaction-model"
	| "compaction-thinking"
	| "subagents"
	| "subagent"
	| "subagent-model"
	| "subagent-thinking"
	| "claude-account"
	| "session"
	| "session-switch"
	| "session-rename"
	| "theme"
	| "theme-editor"
	| "mcp"
	| "memory";

export function settingsBackRoute(route: SettingsRoute): SettingsRoute {
	if (route === "root") return "closed";
	if (route === "session-switch" || route === "session-rename")
		return "session";
	if (route === "theme-editor") return "theme";
	if (route === "compaction-model" || route === "compaction-thinking")
		return "compaction";
	if (route === "subagent") return "subagents";
	if (route === "subagent-model" || route === "subagent-thinking")
		return "subagent";
	return "root";
}

export type SubagentInspectDecision = "close" | "warning" | "direct" | "choose";

export type SubagentNavigationAction = "inspect" | "previous" | "next" | "main";
export type SubagentKeyModifiers = {
	ctrl?: boolean;
	meta?: boolean;
	option?: boolean;
	shift?: boolean;
	super?: boolean;
};

export function subagentNavigationAction(
	inspectorOpen: boolean,
	name: string,
	modifiers: SubagentKeyModifiers = {},
): SubagentNavigationAction | undefined {
	if (inspectorOpen) {
		if (name === "left") return "previous";
		if (name === "right") return "next";
		if (name === "up") return "main";
		return undefined;
	}
	return name === "down" && modifiers.ctrl ? "inspect" : undefined;
}

export function subagentInspectDecision(
	inspectorOpen: boolean,
	targetCount: number,
): SubagentInspectDecision {
	if (inspectorOpen) return "close";
	if (targetCount === 0) return "warning";
	return targetCount === 1 ? "direct" : "choose";
}

export function nextDetailToggle(state: DetailToggleState): boolean {
	const hasVisibleDetails =
		state.toolsExpanded ||
		state.thinkingExpanded ||
		state.compactionExpanded === true ||
		state.hasExpandedToolOverride === true ||
		state.hasExpandedThinkingOverride === true;
	return !hasVisibleDetails;
}

export function isEnterKey(event: KeyEvent): boolean {
	return (
		event.name === "enter" ||
		event.name === "return" ||
		event.name === "kpenter" ||
		event.name === "linefeed"
	);
}

export function isUnmodifiedEnterKey(event: KeyEvent): boolean {
	return (
		isEnterKey(event) &&
		!event.ctrl &&
		!event.meta &&
		!event.shift &&
		!event.option &&
		!event.super &&
		!hasAlt(event)
	);
}

export function hasAlt(event: KeyEvent): boolean {
	return Boolean(event.meta || event.option);
}

export function keyIs(
	event: KeyEvent,
	name: string,
	modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): boolean {
	return (
		event.name === name &&
		(modifiers.ctrl === undefined || Boolean(event.ctrl) === modifiers.ctrl) &&
		(modifiers.shift === undefined ||
			Boolean(event.shift) === modifiers.shift) &&
		(modifiers.alt === undefined || hasAlt(event) === modifiers.alt)
	);
}

export type StreamingCtrlCDecision = "abort" | "force-exit";

export function streamingCtrlCDecision(
	abortInFlight: boolean,
): StreamingCtrlCDecision {
	return abortInFlight ? "force-exit" : "abort";
}
