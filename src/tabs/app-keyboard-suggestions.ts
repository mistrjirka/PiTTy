/** Slash suggestions, including Enter passthrough for complete commands. */
import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import type { KeyboardPorts } from "./app-keyboard-contracts.ts";
import { hasAlt, isUnmodifiedEnterKey } from "../ui/app-navigation.ts";
import { selectCommandChoice } from "../ui/command-suggestions.tsx";

/** Slash completion must pass a complete command through to native submit. */
type SuggestionResult = "continue" | "handled" | "pass";
export function handleSuggestionKey(
	event: KeyEvent,
	ports: Pick<
		KeyboardPorts,
		| "commandSuggestionIndex"
		| "commandSuggestions"
		| "insertSuggestedCommand"
		| "inspectSubagent"
		| "setCommandSuggestionIndex"
	>,
	prompt: TextareaRenderable | undefined,
): SuggestionResult {
	const {
		commandSuggestionIndex,
		commandSuggestions,
		insertSuggestedCommand,
		inspectSubagent,
		setCommandSuggestionIndex,
	} = ports;
	const suggestions = commandSuggestions();
	if (suggestions.length && !inspectSubagent()) {
		if (
			!event.ctrl &&
			!event.meta &&
			!event.shift &&
			!event.option &&
			!event.super &&
			!hasAlt(event) &&
			(event.name === "up" || event.name === "down")
		) {
			event.preventDefault();
			event.stopPropagation();
			setCommandSuggestionIndex((current) => {
				const direction = event.name === "up" ? -1 : 1;
				return (current + direction + suggestions.length) % suggestions.length;
			});
			return "handled";
		}
		if (event.name === "tab" && !event.shift) {
			event.preventDefault();
			event.stopPropagation();
			const command = selectCommandChoice(
				suggestions,
				commandSuggestionIndex(),
			);
			if (command) insertSuggestedCommand(command);
			return "handled";
		}
		if (isUnmodifiedEnterKey(event)) {
			const currentText = prompt?.plainText.trim() ?? "";
			const isCompleteCommand =
				currentText.startsWith("/") && currentText.includes(" ");
			if (isCompleteCommand) {
				// Let the normal submit flow handle it
				return "pass";
			}
			event.preventDefault();
			event.stopPropagation();
			const command = selectCommandChoice(
				suggestions,
				commandSuggestionIndex(),
			);
			if (command) insertSuggestedCommand(command);
			return "handled";
		}
	}

	return "continue";
}
