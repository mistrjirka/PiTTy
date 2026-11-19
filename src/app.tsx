import { createAppSignals } from "./state/app-signals.ts";
import { createAppControllerGraph } from "./tabs/app-controller-graph.ts";
import { AppScreen } from "./ui/app-screen.tsx";

export { appendNotificationHistory } from "./state/notification-history.ts";
export type {
	DetailToggleState,
	SettingsRoute,
	SubagentInspectDecision,
	SubagentKeyModifiers,
	SubagentNavigationAction,
} from "./ui/app-navigation.ts";
export {
	isUnmodifiedEnterKey,
	nextDetailToggle,
	settingsBackRoute,
	streamingCtrlCDecision,
	subagentInspectDecision,
	subagentNavigationAction,
} from "./ui/app-navigation.ts";
export {
	footerHintTiers,
	globalFooterHint,
	selectFooterHint,
} from "./ui/footer-hints.ts";
export type { TranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";
export { attachTranscriptSelectionCache } from "./ui/transcript-selection-cache.ts";

import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import {
	readClaudeAccountPreference,
	resolveClaudeLaunchConfig,
} from "./config/claude-account.ts";
import { PiRpcClient } from "./rpc/pi-rpc-client.ts";
import type { AppOptions } from "./state/app-options.ts";
import { ConversationModel } from "./state/conversation.ts";

export type { AppOptions } from "./state/app-options.ts";

export function shouldShowEmptyDashboard(renderedItemCount: number): boolean {
	return renderedItemCount === 0;
}

export function App(props: AppOptions) {
	const selectedAccount = readClaudeAccountPreference();
	const initialClaudeLaunch = resolveClaudeLaunchConfig(selectedAccount);
	if (initialClaudeLaunch.error)
		throw new Error(
			`Cannot start Pi with selected cswap account: ${initialClaudeLaunch.error}`,
		);
	const claudeLaunchEnv = initialClaudeLaunch.configDir
		? { CLAUDE_CONFIG_DIR: initialClaudeLaunch.configDir }
		: undefined;
	const renderer = useRenderer();
	const dimensions = useTerminalDimensions();
	const client = new PiRpcClient({
		cwd: props.cwd,
		args: props.piArgs,
		...(claudeLaunchEnv ? { env: claudeLaunchEnv } : {}),
		...(props.piExecutable ? { executable: props.piExecutable } : {}),
		logger: props.logger,
	});
	const conversation = new ConversationModel([], props.cwd);
	const appSignals = createAppSignals({
		sidebar: props.sidebar,
		cwd: props.cwd,
		logger: props.logger,
		integrations: props.integrations,
		themeConfig: props.themeConfig,
		themeController: props.themeController,
	});
	const screenPorts = createAppControllerGraph({
		props,
		appSignals,
		renderer,
		dimensions,
		client,
		conversation,
		claudeLaunchEnv,
	});
	return <AppScreen {...screenPorts} />;
}
