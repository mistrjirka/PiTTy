/** Type-only ports for tab activation, forks, and extension UI routing. */
import type {
	CliRenderer,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import type { Accessor, Setter } from "solid-js";
import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { BackgroundTaskSelection } from "../state/background-tasks.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import type { RpcExtensionUIRequest, Toast } from "../types.ts";
import type { CommandChoice } from "../ui/command-suggestions.tsx";
import type { CacheWarning } from "./cache-miss-watch.ts";
import type { CommandCatalogService } from "./command-catalog.ts";
import type { ForkPickerOption } from "./entry-index.ts";
import type { ExtensionRequestRouter } from "./extension-router.ts";
import type { TabManager, TabManagerState } from "./manager.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface TabLifecyclePorts {
	readonly cwd: string;
	readonly piArgs: string[];
	readonly piExecutable: string | undefined;
	readonly claudeLaunchEnv: NodeJS.ProcessEnv | undefined;
	readonly logger: DiagnosticLogger;
	readonly renderer: Pick<CliRenderer, "setTerminalTitle">;
	readonly tabManager: TabManager;
	readonly tabState: Accessor<TabManagerState>;
	readonly setTabState: Setter<TabManagerState>;
	readonly extensionRouter: ExtensionRequestRouter;
	readonly runtimeMap: Accessor<Map<string, ConversationTabRuntime>>;
	readonly setRuntimeMap: Setter<Map<string, ConversationTabRuntime>>;
	readonly activeTabId: Accessor<string>;
	readonly setActiveTabId: Setter<string>;
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly isRuntimeActive: (id: string) => boolean;
	readonly setCommandChoices: Setter<CommandChoice[]>;
	readonly commandCatalog: CommandCatalogService;
	readonly setCompactionRevision: Setter<number>;
	readonly setExtensionStatus: (value: string) => void;
	readonly setStatus: (value: string) => void;
	readonly dialogOwnerRuntimeId: Accessor<string | undefined>;
	readonly setDialogOwnerRuntimeId: Setter<string | undefined>;
	readonly setDialog: Setter<RpcExtensionUIRequest | undefined>;
	readonly setModelSelectorOpen: Setter<boolean>;
	readonly setPromptMapOpen: Setter<boolean>;
	readonly toast: (
		text: string,
		tone: Toast["tone"],
		durationMs?: number,
	) => void;
	readonly touch: () => void;
	readonly backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	readonly closeBackgroundTask: () => void;
	readonly dropRefreshCoordinator: (id: string) => void;
	readonly refreshCommandChoices: (
		runtime: ConversationTabRuntime,
		force?: boolean,
	) => Promise<CommandChoice[]>;
	readonly resetMessageWindow: (totalItems: number) => void;
	readonly selectedSubagentTarget: () => SubagentTarget | undefined;
	readonly subagentScroll: () => ScrollBoxRenderable | undefined;
	readonly scrollToBottom: () => void;
	readonly prompt: () => TextareaRenderable | undefined;
	readonly setDraftSwitchGuard: (value: boolean) => void;
	readonly syncMainDraft: (text: string) => void;
	readonly loadRuntimeHistory: (
		runtime: ConversationTabRuntime,
	) => Promise<void>;
	readonly refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	readonly conversationTouch: (reason?: "stream" | "structure") => void;
	readonly notifyCacheWarning: (
		warning: CacheWarning,
		runtime: ConversationTabRuntime,
	) => void;
	readonly flushQueuedFollowUp: (
		runtime: ConversationTabRuntime,
	) => Promise<void>;
	readonly isExtensionUiRequest: (
		event: unknown,
	) => event is RpcExtensionUIRequest;
	readonly provisionalRuntimes: Set<ConversationTabRuntime>;
	readonly setForkPickerOptions: Setter<ForkPickerOption[]>;
	readonly setForkPickerOpen: Setter<boolean>;
}
