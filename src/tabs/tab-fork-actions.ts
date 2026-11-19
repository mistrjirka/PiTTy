/** Fork one Pi conversation into a provisional session, then publish it. */
import type { ConversationItem, PiEvent } from "../types.ts";
import { alignLatestUserEntryIds, forkPickerOptions } from "./entry-index.ts";
import {
	type ConversationTabRuntime,
	createTabRuntime,
	planForkTab,
	prepareForkedTabRuntime,
	provisionalExtensionUiResponse,
} from "./runtime.ts";
import type { TabLifecyclePorts } from "./tab-lifecycle-contracts.ts";

export interface TabForkHooks {
	nextForkId: () => string;
	activateTab: (id: string) => void;
	refreshTabs: () => void;
	routeRuntimeEvent: (event: PiEvent, runtime: ConversationTabRuntime) => void;
}
export interface TabForkActions {
	forkAt: (entryId: string, userItem?: ConversationItem) => Promise<void>;
	openForkPicker: () => Promise<void>;
}
export function createTabForkActions(
	ports: TabLifecyclePorts,
	actions: TabForkHooks,
): TabForkActions {
	const forkAt = async (
		entryId: string,
		userItem?: ConversationItem | undefined,
	) => {
		const sourceRuntime = ports.activeRuntime();
		const originalSessionFile = sourceRuntime.sessionState?.sessionFile;
		if (!originalSessionFile) {
			ports.toast("The current session file is not available yet.", "warning");
			return;
		}
		// The row button's entry id is text-aligned and can drift after compaction
		// or with duplicated prompts. Re-resolve the clicked visible message
		// against Pi's current forkable list, newest-first, before forking.
		let forkEntryId = entryId;
		if (userItem?.kind === "user") {
			try {
				const messages = await sourceRuntime.client.getForkMessages();
				const userItems = sourceRuntime.conversation.items.filter(
					(item) => item.kind === "user",
				);
				const userIndex = userItems.findIndex(
					(item) => item.id === userItem.id,
				);
				if (userIndex >= 0)
					forkEntryId =
						alignLatestUserEntryIds(userItems, messages)[userIndex] ?? entryId;
			} catch (error) {
				ports.logger?.warn("tabs.fork_resolution_failed", error);
			}
		}
		const plan = planForkTab(
			originalSessionFile,
			"",
			ports.tabState().tabs.length,
		);
		if (!plan.canCreate || sourceRuntime.forkInProgress) {
			ports.toast(
				plan.canCreate
					? "A fork is already being prepared."
					: "Maximum of 8 conversation tabs.",
				"warning",
			);
			return;
		}
		sourceRuntime.forkInProgress = true;
		ports.touch();
		ports.setStatus("forking conversation…");
		const provisionalId = actions.nextForkId();
		const provisional = createTabRuntime({
			id: provisionalId,
			cwd: ports.cwd,
			args: ports.piArgs,
			...(ports.piExecutable ? { executable: ports.piExecutable } : {}),
			sessionFile: originalSessionFile,
			logger: ports.logger,
			...(ports.claudeLaunchEnv ? { env: ports.claudeLaunchEnv } : {}),
			onCacheWarning: (warning, runtime) => {
				ports.logger.warn("cache.large_rewrite", {
					runtimeId: runtime.id,
					...warning,
				});
				if (runtime.id === ports.activeTabId())
					ports.toast(
						`Possible Claude cache rebuild: ${Math.round(warning.currentWrite / 1000)}k tokens rewritten (was ${Math.round(warning.previousRead / 1000)}k cached)`,
						"warning",
						8500,
					);
			},
			onEvent: (event, runtime) => {
				if (ports.runtimeMap().has(runtime.id)) {
					actions.routeRuntimeEvent(event, runtime);
					return;
				}
				if (ports.isExtensionUiRequest(event))
					void runtime.client
						.sendExtensionUiResponse(provisionalExtensionUiResponse(event))
						.catch((cancelError) =>
							ports.logger.warn(
								"tabs.provisional_extension_response_failed",
								cancelError,
							),
						);
			},
			onConversationChange: (tabRuntime, reason) => {
				if (tabRuntime.id === ports.activeTabId())
					ports.conversationTouch(reason);
			},
		});
		ports.provisionalRuntimes.add(provisional);
		try {
			const branchedState = await prepareForkedTabRuntime(
				provisional,
				forkEntryId,
				240_000,
			);
			const finalPlan = planForkTab(
				originalSessionFile,
				branchedState.sessionFile,
				ports.tabState().tabs.length,
			);
			if (!finalPlan.canCreate)
				throw new Error("Maximum of 8 conversation tabs.");
			if (!ports.tabManager.create({ id: provisionalId, badges: 0 }))
				throw new Error("Maximum of 8 conversation tabs.");
			ports.provisionalRuntimes.delete(provisional);
			ports.setRuntimeMap((current) =>
				new Map(current).set(provisionalId, provisional),
			);
			actions.refreshTabs();
			actions.activateTab(provisionalId);
			ports.setStatus(branchedState.isStreaming ? "working" : "ready");
			ports.toast("Fork created.", "success");
		} catch (error) {
			ports.provisionalRuntimes.delete(provisional);
			ports.extensionRouter.remove(provisionalId);
			provisional.messageUpdates.dispose();
			provisional.coalescer.flush();
			try {
				await provisional.client.stop();
			} catch (stopError) {
				ports.logger.warn("tabs.provisional_stop_failed", stopError);
			}
			ports.toast(
				error instanceof Error ? error.message : String(error),
				"error",
				5000,
			);
		} finally {
			sourceRuntime.forkInProgress = false;
			if (ports.isRuntimeActive(sourceRuntime.id)) ports.touch();
			ports.setStatus(
				ports.activeRuntime().conversation.isStreaming ? "working" : "ready",
			);
		}
	};
	const openForkPicker = async () => {
		const runtime = ports.activeRuntime();
		if (!runtime.startupResolved) {
			ports.toast("This tab is still starting…", "info");
			return;
		}
		try {
			const messages = await runtime.client.getForkMessages();
			ports.setForkPickerOptions(forkPickerOptions(messages));
			ports.setForkPickerOpen(true);
		} catch (error) {
			ports.toast(
				`Failed to load fork points: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	};

	return { forkAt, openForkPicker };
}
