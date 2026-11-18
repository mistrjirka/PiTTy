/** Modal and tab keyboard precedence, ahead of global shortcuts. */
import type { KeyEvent } from "@opentui/core";
import type { KeyboardPorts } from "./app-keyboard-contracts.ts";
import { settingsBackRoute } from "../ui/app-navigation.ts";

/** Existing modal order: tabs, settings, task dialogs, and extension UI. */
export function handleModalKey(
	event: KeyEvent,
	ports: Pick<
		KeyboardPorts,
		| "activateTab"
		| "backgroundSelection"
		| "closeBackgroundTask"
		| "closeMemoryBrowser"
		| "closeNotification"
		| "closePromptMap"
		| "closeSessionSelector"
		| "closeSettings"
		| "closeTodo"
		| "completeDialog"
		| "dialog"
		| "forkPickerOpen"
		| "mcpView"
		| "memoryBrowserOpen"
		| "modelSelectorOpen"
		| "notificationDetailId"
		| "promptMapOpen"
		| "sessionSelectorOpen"
		| "setMcpView"
		| "setModelSelectorOpen"
		| "setSettingsRoute"
		| "setSubagentSelectorOpen"
		| "settingsRoute"
		| "skillSelectorOpen"
		| "subagentSelectorOpen"
		| "tabManager"
		| "todoDetailId"
	>,
): boolean {
	const {
		activateTab,
		backgroundSelection,
		closeBackgroundTask,
		closeMemoryBrowser,
		closeNotification,
		closePromptMap,
		closeSessionSelector,
		closeSettings,
		closeTodo,
		completeDialog,
		dialog,
		forkPickerOpen,
		mcpView,
		memoryBrowserOpen,
		modelSelectorOpen,
		notificationDetailId,
		promptMapOpen,
		sessionSelectorOpen,
		setMcpView,
		setModelSelectorOpen,
		setSettingsRoute,
		setSubagentSelectorOpen,
		settingsRoute,
		skillSelectorOpen,
		subagentSelectorOpen,
		tabManager,
		todoDetailId,
	} = ports;
	if (event.eventType === "release") return true;
	if (event.ctrl && event.name === "tab" && !forkPickerOpen()) {
		event.preventDefault();
		event.stopPropagation();
		const nextId = tabManager.cycle(event.shift ? -1 : 1);
		activateTab(nextId);
		return true;
	}
	if (settingsRoute() !== "closed") {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			const route = settingsRoute();
			if (route === "root") closeSettings();
			else if (route === "mcp" && mcpView() === "form") setMcpView("list");
			else if (route === "model") {
				setModelSelectorOpen(false);
				setSettingsRoute("root");
			} else if (route === "session-switch") closeSessionSelector();
			else if (route === "memory") closeMemoryBrowser();
			else setSettingsRoute(settingsBackRoute(route));
		}
		return true;
	}
	if (backgroundSelection()) {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			closeBackgroundTask();
		}
		return true;
	}
	if (notificationDetailId()) {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			closeNotification();
		}
		return true;
	}
	if (todoDetailId()) {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			closeTodo();
		}
		return true;
	}
	if (subagentSelectorOpen()) {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			setSubagentSelectorOpen(false);
		}
		return true;
	}
	if (
		sessionSelectorOpen() ||
		modelSelectorOpen() ||
		memoryBrowserOpen() ||
		forkPickerOpen() ||
		skillSelectorOpen()
	)
		return true;
	if (promptMapOpen()) {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			closePromptMap();
		}
		return true;
	}
	if (dialog()) {
		if (event.name === "escape") {
			event.preventDefault();
			event.stopPropagation();
			void completeDialog({ cancelled: true });
		} else if (dialog()?.method === "confirm" && event.name === "enter") {
			event.preventDefault();
			event.stopPropagation();
			void completeDialog({ confirmed: true });
		}
		return true;
	}

	return false;
}
