/** Boot-time RPC, usage polling and UI monitoring lifetime. */

import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { type Accessor, onCleanup, onMount, type Setter } from "solid-js";
import type { AppOptions } from "../app.tsx";
import type { CswapSnapshot } from "../integrations/claude-swap.ts";
import type { AppSignals } from "../state/app-signals.ts";
import type { StartupPhase } from "../state/startup.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { RpcSessionState, SubagentRun, Toast } from "../types.ts";
import type { ModelChoice } from "../ui/model-selector.tsx";
import { startInitialSession } from "./initial-session.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import { startUiMonitoring } from "./ui-monitoring.ts";
import { startUsagePolling } from "./usage-polling.ts";

export interface AppLifecycleBootPorts {
	props: AppOptions;
	signals: AppSignals;
	bootRuntime: ConversationTabRuntime;
	startupPhase: Accessor<StartupPhase>;
	setStartupPhase: Setter<StartupPhase>;
	setStatus: (text: string) => void;
	setExtensionStatus: (text: string) => void;
	isRuntimeActive: (id: string) => boolean;
	resetMessageWindow: (count: number) => void;
	rememberThinkingLevel: (runtime: ConversationTabRuntime) => void;
	fetchAvailableModels: () => Promise<ModelChoice[]>;
	touch: () => void;
	conversationTouch: () => void;
	getScroll: () => ScrollBoxRenderable | undefined;
	getPrompt: () => TextareaRenderable | undefined;
	openSessionSelector: () => void;
	discoverCurrentSessions: () => Promise<void>;
	refreshState: (runtime?: ConversationTabRuntime) => Promise<boolean>;
	toast: (text: string, tone: Toast["tone"], durationMs?: number) => void;
	applyCswapUsage: (snapshot: CswapSnapshot) => void;
	claudeEffectiveSlot: () => number | undefined;
	refreshSubagentRuns: (state: RpcSessionState) => void;
	sessionState: () => RpcSessionState | undefined;
	status: Accessor<string>;
	streaming: Accessor<boolean>;
	activeRuntime: () => ConversationTabRuntime;
	runs: () => SubagentRun[];
	availableSubagentTargets: () => SubagentTarget[];
}
export function registerAppLifecycleBoot(ports: AppLifecycleBootPorts): void {
	const props = ports.props;
	const {
		bootRuntime,
		startupPhase,
		setStartupPhase,
		setStatus,
		setExtensionStatus,
		resetMessageWindow,
		rememberThinkingLevel,
		fetchAvailableModels,
		touch,
		conversationTouch,
		openSessionSelector,
		discoverCurrentSessions,
		refreshState,
		toast,
		applyCswapUsage,
		claudeEffectiveSlot,
		refreshSubagentRuns,
		sessionState,
		status,
		streaming,
		activeRuntime,
		runs,
		availableSubagentTargets,
	} = ports;
	const tabRuntimeIsActive = ports.isRuntimeActive;
	const {
		rpcAvailable: [, setRpcAvailable],
		commandCatalog,
		commandChoices: [, setCommandChoices],
		codexUsage: [, setCodexUsage],
		codexUsageStats: [, setCodexUsageStats],
		opencodeUsage: [, setOpencodeUsage],
		opencodeUsageStats: [, setOpencodeUsageStats],
		cswapSnapshot: [, setCswapSnapshot],
		claudeUsage: [, setClaudeUsage],
		claudeHint: [, setClaudeHint],
		spinnerIndex: [, setSpinnerIndex],
		clockNow: [, setClockNow],
		provisionalRuntimes,
		runtimeMap: [runtimeMap],
	} = ports.signals;
	const SESSION_LOAD_REQUEST_TIMEOUT_MS = 120_000;
	const STARTUP_DEADLINE_MS = 180_000;
	onMount(() => {
		startInitialSession({
			runtime: bootRuntime,
			logger: props.logger,
			cwd: props.cwd,
			sidebar: props.sidebar,
			themeWarning: props.themeWarning,
			integrations: props.integrations,
			openSessionSelectorOnStartup: props.openSessionSelector === true,
			startupPhase,
			setStartupPhase,
			setStatus,
			setExtensionStatus,
			setRpcAvailable,
			isRuntimeActive: tabRuntimeIsActive,
			commandCatalog,
			setCommandChoices,
			resetMessageWindow,
			rememberThinkingLevel,
			fetchAvailableModels,
			touch,
			conversationTouch: () => conversationTouch(),
			scrollToLatest: () =>
				ports.getScroll()?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER }),
			openSessionSelector,
			focusPrompt: () => ports.getPrompt()?.focus(),
			discoverCurrentSessions,
			refreshState,
			toast,
			sessionLoadTimeoutMs: SESSION_LOAD_REQUEST_TIMEOUT_MS,
			startupDeadlineMs: STARTUP_DEADLINE_MS,
			updateEnvironment: process.env,
		});
		const stopUsagePolling = startUsagePolling({
			logger: props.logger,
			doppelclaudeInstalled: props.integrations.doppelclaude.installed,
			setCodexUsage,
			setCodexUsageStats,
			setOpencodeUsage,
			setOpencodeUsageStats,
			setCswapSnapshot,
			setClaudeUsage,
			setClaudeHint,
			applyCswapUsage,
			claudeEffectiveSlot,
		});
		const stopUiMonitoring = startUiMonitoring({
			logger: props.logger,
			subagentsInstalled: props.integrations.subagents.installed,
			refreshState,
			refreshSubagentRuns,
			sessionState,
			setSpinnerIndex,
			setClockNow,
			status,
			streaming,
			activeRuntime,
			runs,
			availableSubagentTargets,
		});
		onCleanup(() => {
			for (const runtime of provisionalRuntimes) {
				runtime.messageUpdates.dispose();
				runtime.coalescer.flush();
				void runtime.client.stop();
			}
			provisionalRuntimes.clear();
			for (const runtime of runtimeMap().values()) {
				runtime.messageUpdates.dispose();
				runtime.coalescer.flush();
				void runtime.client.stop();
			}
			stopUiMonitoring();
			stopUsagePolling();
			props.logger.info("ui.cleanup");
		});
	});
}
