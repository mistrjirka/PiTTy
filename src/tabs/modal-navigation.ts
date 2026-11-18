/** Request-map navigation, memory browsing and extension-dialog completion. */
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { Accessor, Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import {
	loadMemorySnapshot,
	removeMemoryEntry,
	type MemoryEntry,
	type MemorySnapshot,
} from "../integrations/memory-store.ts";
import type {
	ConversationItem,
	RpcExtensionUIRequest,
	Toast,
} from "../types.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { PromptMapEntry } from "../ui/prompt-map.tsx";
import type { ExtensionDialogResponse } from "../ui/utility-overlays.tsx";
import type { ConversationTabRuntime } from "./runtime.ts";
import type {
	ExtensionRequestEnvelope,
	ExtensionRequestRouter,
} from "./extension-router.ts";

export interface ModalNavigationPorts {
	cwd: string;
	memoryInstalled: boolean;
	setPromptMapOpen: Setter<boolean>;
	promptMapEntries: () => PromptMapEntry[];
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	setModelSelectorOpen: Setter<boolean>;
	items: () => ConversationItem[];
	messageWindowStart: Accessor<number>;
	setMessageWindowStart: Setter<number>;
	getPrompt: () => TextareaRenderable | undefined;
	getScroll: () => ScrollBoxRenderable | undefined;
	updateScrollPosition: () => void;
	setMemoryBrowserOpen: Setter<boolean>;
	settingsRoute: Accessor<SettingsRoute>;
	setSettingsRoute: Setter<SettingsRoute>;
	memorySnapshot: Accessor<MemorySnapshot | undefined>;
	setMemorySnapshot: Setter<MemorySnapshot | undefined>;
	dialog: Accessor<RpcExtensionUIRequest | undefined>;
	dialogOwnerRuntimeId: Accessor<string | undefined>;
	runtimeMap: Accessor<Map<string, ConversationTabRuntime>>;
	logger: DiagnosticLogger;
	setDialog: Setter<RpcExtensionUIRequest | undefined>;
	setDialogOwnerRuntimeId: Setter<string | undefined>;
	extensionRouter: ExtensionRequestRouter;
	tabRuntimeIsActive: (id: string) => boolean;
	handleExtensionRequest: (envelope: ExtensionRequestEnvelope) => void;
}

export interface ModalNavigationActions {
	closePromptMap: () => void;
	openPromptMap: () => void;
	jumpToPrompt: (entry: PromptMapEntry) => void;
	closeMemoryBrowser: () => void;
	openMemoryBrowser: (fromSettings?: boolean) => void;
	removeMemory: (entry: MemoryEntry) => void;
	completeDialog: (response: ExtensionDialogResponse) => Promise<void>;
}

export function createModalNavigation(
	ports: ModalNavigationPorts,
): ModalNavigationActions {
	const closePromptMap = () => {
		ports.setPromptMapOpen(false);
		queueMicrotask(() => ports.getPrompt()?.focus());
	};

	const openPromptMap = () => {
		if (!ports.promptMapEntries().length) {
			ports.toast("No user requests in this session yet", "warning");
			return;
		}
		ports.setModelSelectorOpen(false);
		ports.setPromptMapOpen(true);
	};

	const jumpToPrompt = (entry: PromptMapEntry) => {
		ports.setPromptMapOpen(false);
		const targetIndex = ports.items().findIndex((item) => item.id === entry.id);
		if (targetIndex >= 0 && targetIndex < ports.messageWindowStart()) {
			ports.setMessageWindowStart(targetIndex);
		}
		queueMicrotask(() =>
			queueMicrotask(() => {
				ports.getScroll()?.scrollChildIntoView(entry.id);
				ports.updateScrollPosition();
				ports.getPrompt()?.focus();
			}),
		);
	};

	const closeMemoryBrowser = () => {
		ports.setMemoryBrowserOpen(false);
		if (ports.settingsRoute() === "memory") {
			ports.setSettingsRoute("root");
			return;
		}
		queueMicrotask(() => ports.getPrompt()?.focus());
	};

	const openMemoryBrowser = (fromSettings = false) => {
		if (!ports.memoryInstalled) {
			ports.toast(
				"Install pi-hermes-memory to browse persistent memory",
				"info",
				5000,
			);
			return;
		}
		try {
			const snapshot = loadMemorySnapshot(ports.cwd);
			ports.setMemorySnapshot(snapshot);
			ports.setModelSelectorOpen(false);
			ports.setMemoryBrowserOpen(true);
			if (fromSettings) ports.setSettingsRoute("memory");
		} catch (error) {
			ports.toast(
				`Unable to read memory files: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	};

	const removeMemory = (entry: MemoryEntry) => {
		const snapshot = ports.memorySnapshot();
		const file = snapshot?.files.find(
			(candidate) => candidate.filePath === entry.filePath,
		);
		if (!file) return;
		const result = removeMemoryEntry(entry, file.fileContent);
		if (!result.success) {
			ports.toast(result.error, "error", 6000);
			return;
		}
		ports.toast("Memory entry removed", "success");
		ports.setMemorySnapshot(loadMemorySnapshot(ports.cwd));
	};

	const completeDialog = async (response: ExtensionDialogResponse) => {
		const request = ports.dialog();
		const ownerRuntimeId = ports.dialogOwnerRuntimeId();
		const ownerRuntime = ownerRuntimeId
			? ports.runtimeMap().get(ownerRuntimeId)
			: undefined;
		if (!request || !ownerRuntimeId || !ownerRuntime) return;
		ports.logger.info("ui.extension_dialog_response", {
			method: request.method,
			cancelled: response.cancelled === true,
			confirmed: response.confirmed,
		});
		ports.setDialog(undefined);
		ports.setDialogOwnerRuntimeId(undefined);
		const next = ports.extensionRouter.complete(ownerRuntimeId, request.id);
		if (response.cancelled)
			await ownerRuntime.client.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: request.id,
				cancelled: true,
			});
		else if (typeof response.confirmed === "boolean")
			await ownerRuntime.client.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: request.id,
				confirmed: response.confirmed,
			});
		else
			await ownerRuntime.client.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: request.id,
				value: response.value ?? "",
			});
		if (next && ports.tabRuntimeIsActive(ownerRuntimeId))
			ports.handleExtensionRequest(next);
		ports.getPrompt()?.focus();
	};

	return {
		closePromptMap,
		openPromptMap,
		jumpToPrompt,
		closeMemoryBrowser,
		openMemoryBrowser,
		removeMemory,
		completeDialog,
	};
}
