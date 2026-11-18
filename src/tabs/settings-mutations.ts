/** Model, theme and session-name settings mutations, with explicit Pi ports. */
import type { Accessor, Setter } from "solid-js";
import type { ThemeConfigDocument } from "../config/theme-config.ts";
import { writeThemeConfig } from "../config/theme-config.ts";
import type { ThinkingLevel } from "../rpc/pi-rpc-client.ts";
import type { SettingsRoute } from "../ui/app-navigation.ts";
import type { ModelChoice } from "../ui/model-selector.tsx";
import type { SettingsAction } from "../ui/settings-descriptors.ts";
import type { ThemeController, ThemePalette } from "../ui/theme.ts";
import type { ThemePresetName } from "../ui/theme-presets.ts";
import { commitThemeDocument } from "../ui/theme-transaction.ts";
import type { SettingsErrorMap } from "./extension-model-actions.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export type ThemeViewportSnapshot = {
	mainTop: number | undefined;
	subagentTop: number | undefined;
};

export interface SettingsMutationPorts {
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly settingsBusy: Accessor<SettingsAction | undefined>;
	readonly setSettingsBusy: Setter<SettingsAction | undefined>;
	readonly setSettingsErrors: Setter<SettingsErrorMap>;
	readonly setSettingsRoute: Setter<SettingsRoute>;
	readonly setSettingsSelectedId: Setter<string>;
	readonly rememberThinkingLevel: (
		runtime: ConversationTabRuntime,
		level?: ThinkingLevel,
	) => void;
	readonly applyRememberedThinkingLevel: (
		runtime: ConversationTabRuntime,
		provider: string,
		modelId: string,
	) => Promise<void>;
	readonly refreshState: (runtime: ConversationTabRuntime) => Promise<boolean>;
	readonly themeConfig: Accessor<ThemeConfigDocument>;
	readonly setThemeConfig: Setter<ThemeConfigDocument>;
	readonly themeController: ThemeController;
	readonly captureThemeViewport: () => ThemeViewportSnapshot;
	readonly restoreThemeViewport: (snapshot: ThemeViewportSnapshot) => void;
}

export interface SettingsMutations {
	applySettingsModel: (model: ModelChoice) => Promise<void>;
	applySettingsThinking: (level: ThinkingLevel) => Promise<void>;
	applyThemePreset: (preset: ThemePresetName) => void;
	applyThemeToken: (token: keyof ThemePalette, value: string) => void;
	resetTheme: () => void;
	applySettingsRename: (name: string) => Promise<void>;
}

export function createSettingsMutations(
	ports: SettingsMutationPorts,
): SettingsMutations {
	const applySettingsModel = async (model: ModelChoice) => {
		if (ports.settingsBusy()) return;
		const runtime = ports.activeRuntime();
		ports.rememberThinkingLevel(runtime);
		ports.setSettingsRoute("root");
		ports.setSettingsSelectedId("model");
		ports.setSettingsBusy("model");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.model;
			return next;
		});
		try {
			await runtime.client.setModel(model.provider, model.id);
			await ports.applyRememberedThinkingLevel(
				runtime,
				model.provider,
				model.id,
			);
			if (!(await ports.refreshState(runtime)))
				throw new Error(
					"Pi accepted the model change but state refresh failed.",
				);
			ports.setSettingsRoute("root");
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				model: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};
	const applySettingsThinking = async (level: ThinkingLevel) => {
		if (ports.settingsBusy()) return;
		ports.setSettingsRoute("root");
		ports.setSettingsSelectedId("thinking");
		const runtime = ports.activeRuntime();
		ports.setSettingsBusy("thinking");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.thinking;
			return next;
		});
		try {
			await runtime.client.setThinkingLevel(level);
			ports.rememberThinkingLevel(runtime, level);
			if (!(await ports.refreshState(runtime)))
				throw new Error(
					"Pi accepted the effort change but state refresh failed.",
				);
			ports.rememberThinkingLevel(runtime, level);
			ports.setSettingsRoute("root");
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				thinking: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};
	const applyThemeDocument = async (document: ThemeConfigDocument) => {
		if (ports.settingsBusy() === "theme") return;
		const previous = ports.themeConfig();
		ports.setSettingsBusy("theme");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.theme;
			return next;
		});
		const viewport = ports.captureThemeViewport();
		ports.setThemeConfig(document);
		const pendingCommit = commitThemeDocument(
			ports.themeController,
			previous,
			document,
			writeThemeConfig,
		);
		ports.restoreThemeViewport(viewport);
		const result = await pendingCommit;
		ports.setThemeConfig(result.document);
		if (!result.ok) {
			ports.restoreThemeViewport(viewport);
			ports.setSettingsErrors((errors) => ({ ...errors, theme: result.error }));
		}
		ports.setSettingsBusy(undefined);
	};
	const applyThemePreset = (preset: ThemePresetName) =>
		void applyThemeDocument({ version: 1, theme: { preset, overrides: {} } });
	const applyThemeToken = (token: keyof ThemePalette, value: string) =>
		void applyThemeDocument({
			version: 1,
			theme: {
				preset: ports.themeConfig().theme.preset,
				overrides: {
					...ports.themeConfig().theme.overrides,
					[token]: value.toUpperCase(),
				},
			},
		});
	const resetTheme = () =>
		void applyThemeDocument({
			version: 1,
			theme: { preset: ports.themeConfig().theme.preset, overrides: {} },
		});

	const applySettingsRename = async (name: string) => {
		if (ports.settingsBusy()) return;
		const runtime = ports.activeRuntime();
		ports.setSettingsBusy("rename");
		ports.setSettingsErrors((errors) => {
			const next = { ...errors };
			delete next.rename;
			return next;
		});
		try {
			await runtime.client.setSessionName(name);
			if (!(await ports.refreshState(runtime)))
				throw new Error("Rename accepted but session refresh failed.");
			ports.setSettingsRoute("session");
		} catch (error) {
			ports.setSettingsErrors((errors) => ({
				...errors,
				rename: error instanceof Error ? error.message : String(error),
			}));
		} finally {
			ports.setSettingsBusy(undefined);
		}
	};

	return {
		applySettingsModel,
		applySettingsThinking,
		applyThemePreset,
		applyThemeToken,
		resetTheme,
		applySettingsRename,
	};
}
