/** Session discovery and switch confirmation, with state owned by App. */
import type { Accessor, Setter } from "solid-js";
import {
	discoverSessions,
	type SessionChoice,
	type SessionDiscoveryState,
} from "../sessions.ts";
import type { RpcSessionState, Toast } from "../types.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import type { SessionController } from "./session-controller.ts";

type PendingSessionReason = "streaming" | "queued";

export interface SessionPickerPorts {
	readonly cwd: string;
	readonly sessionLoadTimeoutMs: number;
	readonly sessionState: () => RpcSessionState | undefined;
	readonly setSessionDiscovery: Setter<SessionDiscoveryState>;
	readonly sessionSwitching: Accessor<boolean>;
	readonly setSessionSwitching: Setter<boolean>;
	readonly pendingSession: Accessor<SessionChoice | undefined>;
	readonly setPendingSession: Setter<SessionChoice | undefined>;
	readonly pendingSessionReason: Accessor<PendingSessionReason | undefined>;
	readonly setPendingSessionReason: Setter<PendingSessionReason | undefined>;
	readonly setSessionSelectorOpen: Setter<boolean>;
	readonly settingsRoute: Accessor<SettingsRoute>;
	readonly setSettingsRoute: Setter<SettingsRoute>;
	readonly focusMainPrompt: () => void;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly touch: () => void;
	readonly sessionController: Pick<SessionController, "switchAndLoad">;
	readonly afterSessionLoaded: (
		runtime: ConversationTabRuntime,
		historyLength: number,
	) => Promise<void>;
	readonly toast: (
		text: string,
		tone: Toast["tone"],
		duration?: number,
	) => void;
}

export interface SessionPickerActions {
	discoverCurrentSessions: () => Promise<void>;
	openSessionSelector: () => void;
	closeSessionSelector: () => void;
	switchToSession: (choice: SessionChoice) => Promise<void>;
}

export function createSessionPickerActions(
	ports: SessionPickerPorts,
): SessionPickerActions {
	let discoveryGeneration = 0;
	const discoverCurrentSessions = async () => {
		const generation = ++discoveryGeneration;
		ports.setSessionDiscovery({ kind: "loading" });
		try {
			const choices = await discoverSessions(
				ports.cwd,
				ports.sessionState()?.sessionFile,
				(loaded, total) => {
					if (generation === discoveryGeneration)
						ports.setSessionDiscovery({
							kind: "loading",
							progress: { loaded, total },
						});
				},
			);
			if (generation !== discoveryGeneration) return;
			ports.setSessionDiscovery(
				choices.length
					? { kind: "success", choices }
					: { kind: "empty", choices: [] },
			);
		} catch (error) {
			if (generation !== discoveryGeneration) return;
			ports.setSessionDiscovery({
				kind: "error",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const openSessionSelector = () => {
		ports.setSessionSelectorOpen(true);
		void discoverCurrentSessions();
	};

	const closeSessionSelector = () => {
		if (ports.sessionSwitching()) return;
		ports.setPendingSession(undefined);
		ports.setPendingSessionReason(undefined);
		ports.setSessionSelectorOpen(false);
		if (ports.settingsRoute() === "session-switch")
			ports.setSettingsRoute("session");
		else ports.focusMainPrompt();
	};

	const switchToSession = async (choice: SessionChoice) => {
		const runtime = ports.activeRuntime();
		if (ports.sessionSwitching()) return;
		if (!ports.pendingSession() && runtime.queuedFollowUps.length) {
			ports.setPendingSession(choice);
			ports.setPendingSessionReason("queued");
			return;
		}
		if (runtime.conversation.isStreaming && !ports.pendingSession()) {
			ports.setPendingSession(choice);
			ports.setPendingSessionReason("streaming");
			return;
		}
		if (ports.pendingSessionReason() === "queued") {
			runtime.queuedFollowUps = [];
			ports.touch();
		}
		ports.setSessionSwitching(true);
		try {
			const result = await ports.sessionController.switchAndLoad(
				runtime,
				choice.path,
				ports.sessionLoadTimeoutMs,
			);
			if (result.cancelled) {
				ports.setPendingSession(undefined);
				ports.setPendingSessionReason(undefined);
				ports.toast("Session switch was cancelled by Pi", "warning");
				return;
			}
			await ports.afterSessionLoaded(runtime, result.historyLength);
			ports.setSessionSelectorOpen(false);
			if (ports.settingsRoute() === "session-switch")
				ports.setSettingsRoute("root");
			ports.setPendingSession(undefined);
			ports.setPendingSessionReason(undefined);
			ports.toast(`Resumed ${choice.name}`, "success");
		} catch (error) {
			ports.setPendingSession(undefined);
			ports.setPendingSessionReason(undefined);
			const message = error instanceof Error ? error.message : String(error);
			ports.toast(
				message.includes("switch_session")
					? "Session switching requires a Pi version with RPC switch_session support."
					: `Failed to switch session: ${message}`,
				"error",
			);
		} finally {
			ports.setSessionSwitching(false);
			ports.focusMainPrompt();
		}
	};

	return {
		discoverCurrentSessions,
		openSessionSelector,
		closeSessionSelector,
		switchToSession,
	};
}
