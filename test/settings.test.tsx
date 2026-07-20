import { afterEach, describe, expect, test } from "bun:test";
import type { SelectRenderable, TextareaRenderable } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal, type JSX } from "solid-js";
import {
	globalFooterHint,
	settingsBackRoute,
	subagentNavigationAction,
} from "../src/app.tsx";
import { SessionRename, SessionSettings } from "../src/ui/session-settings.tsx";
import {
	SettingsHub,
	type SettingsSectionDescriptor,
} from "../src/ui/settings-hub.tsx";
import { ThinkingSelector } from "../src/ui/thinking-selector.tsx";
import {
	filterThemeTokens,
	ThemePresetBrowser,
	ThemeTokenEditor,
} from "../src/ui/theme-settings.tsx";
import { colors, type ThemePalette } from "../src/ui/theme.ts";
import {
	themeColorTokens,
	themePresetNames,
	themePresets,
} from "../src/ui/theme-presets.ts";
import {
	McpSettings,
	type McpConfigState,
	type McpInstallState,
	type McpSettingsView,
} from "../src/ui/mcp-settings.tsx";
import type { McpConfigSnapshot, McpScope } from "../src/config/mcp-config.ts";

const active: TestRendererSetup[] = [];
afterEach(() => {
	for (const setup of active.splice(0)) setup.renderer.destroy();
});

async function mount(
	node: () => JSX.Element,
	width = 100,
	height = 30,
): Promise<TestRendererSetup> {
	const setup = await testRender(node, {
		width,
		height,
		useMouse: true,
		enableMouseMovement: true,
	});
	active.push(setup);
	await setup.flush();
	await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 60 });
	return setup;
}

async function clickText(
	setup: TestRendererSetup,
	text: string,
): Promise<void> {
	const lines = setup.captureCharFrame().split("\n");
	const y = lines.findIndex((line) => line.includes(text));
	const x = y >= 0 ? lines[y]!.indexOf(text) : -1;
	expect(y).toBeGreaterThanOrEqual(0);
	expect(x).toBeGreaterThanOrEqual(0);
	await setup.mockMouse.click(x, y);
	await setup.flush();
}

function descriptors(
	opened: string[],
	busy: () => boolean = () => false,
	error: () => string | undefined = () => undefined,
): SettingsSectionDescriptor[] {
	return [
		{
			id: "model",
			label: "Model",
			summary: () => "provider/model",
			disabledReason: () => undefined,
			busy,
			inlineError: error,
			open: () => opened.push("model"),
		},
		{
			id: "thinking",
			label: "Thinking effort",
			summary: () => "high",
			disabledReason: () => undefined,
			busy,
			inlineError: error,
			open: () => opened.push("thinking"),
		},
		{
			id: "session",
			label: "Session",
			summary: () => "Current session",
			disabledReason: () => undefined,
			busy,
			inlineError: error,
			open: () => opened.push("session"),
		},
	];
}

describe("Settings components", () => {
	test("renders ordered descriptors and opens the selected row", async () => {
		const opened: string[] = [];
		const setup = await mount(() => (
			<SettingsHub
				descriptors={() => descriptors(opened)}
				selectedId={() => "model"}
				onSelected={() => {}}
				onClose={() => {}}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame.indexOf("Model")).toBeLessThan(
			frame.indexOf("Thinking effort"),
		);
		expect(frame.indexOf("Thinking effort")).toBeLessThan(
			frame.indexOf("Session"),
		);
		expect(frame).toContain("provider/model");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(opened).toEqual(["model"]);
	});

	test("reports and restores the originating selected row", async () => {
		const selected: string[] = [];
		const opened: string[] = [];
		const first = await mount(() => (
			<SettingsHub
				descriptors={() => descriptors(opened)}
				selectedId={() => selected.at(-1) ?? "model"}
				onSelected={(id) => selected.push(id)}
				onClose={() => {}}
			/>
		));
		first.mockInput.pressArrow("down");
		first.mockInput.pressEnter();
		await first.flush();
		expect(selected).toEqual(["thinking"]);
		expect(opened).toEqual(["thinking"]);

		const restored = await mount(() => (
			<SettingsHub
				descriptors={() => descriptors([])}
				selectedId={() => selected.at(-1) ?? "model"}
				onSelected={() => {}}
				onClose={() => {}}
			/>
		));
		const select = restored.renderer.root.findDescendantById(
			"settings-sections",
		) as SelectRenderable | undefined;
		expect(select?.getSelectedIndex()).toBe(1);
	});

	test("mouse activates enabled rows", async () => {
		const opened: string[] = [];
		const setup = await mount(() => (
			<SettingsHub
				descriptors={() => descriptors(opened)}
				selectedId={() => "model"}
				onSelected={() => {}}
				onClose={() => {}}
			/>
		));
		await clickText(setup, "Thinking effort");
		expect(opened).toEqual(["thinking"]);
	});

	test("RPC-unavailable rows show a reason and reject keyboard and mouse activation", async () => {
		const opened: string[] = [];
		const rows = descriptors(opened).map((row) => ({
			...row,
			disabledReason: () => "Pi RPC unavailable",
		}));
		const setup = await mount(() => (
			<SettingsHub
				descriptors={() => rows}
				selectedId={() => "model"}
				onSelected={() => {}}
				onClose={() => {}}
			/>
		));
		expect(setup.captureCharFrame()).toContain("Pi RPC unavailable");
		setup.mockInput.pressEnter();
		await setup.flush();
		await clickText(setup, "Model");
		expect(opened).toEqual([]);
	});

	test("reactively renders one row busy and exposes inline errors", async () => {
		const [busy, setBusy] = createSignal(false);
		const [error, setError] = createSignal<string | undefined>();
		const setup = await mount(() => (
			<SettingsHub
				descriptors={() => descriptors([], busy, error)}
				selectedId={() => "model"}
				onSelected={() => {}}
				onClose={() => {}}
			/>
		));
		setBusy(true);
		setError("failed");
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Applying…");
		expect(frame).toContain("Model: failed");
	});

	test("root close and nested back routes are explicit", async () => {
		let closed = 0;
		const setup = await mount(() => (
			<SettingsHub
				descriptors={() => descriptors([])}
				selectedId={() => "model"}
				onSelected={() => {}}
				onClose={() => {
					closed += 1;
				}}
			/>
		));
		await clickText(setup, "× Close");
		expect(closed).toBe(1);
		expect(settingsBackRoute("root")).toBe("closed");
		expect(settingsBackRoute("model")).toBe("root");
		expect(settingsBackRoute("thinking")).toBe("root");
		expect(settingsBackRoute("session")).toBe("root");
		expect(settingsBackRoute("session-switch")).toBe("session");
		expect(settingsBackRoute("session-rename")).toBe("session");
		expect(settingsBackRoute("theme")).toBe("root");
		expect(settingsBackRoute("theme-editor")).toBe("theme");
	});

	test("thinking effort supports keyboard and mouse selection", async () => {
		const selected: string[] = [];
		const keyboard = await mount(
			() => (
				<ThinkingSelector
					current="medium"
					onSelect={(level) => selected.push(level)}
					onCancel={() => {}}
				/>
			),
			80,
			24,
		);
		const frame = keyboard.captureCharFrame();
		expect(frame).toContain("Thinking effort");
		expect(frame).toContain("← Settings");
		expect(frame).toContain("max");
		keyboard.mockInput.pressArrow("down");
		keyboard.mockInput.pressEnter();
		await keyboard.flush();
		expect(selected).toEqual(["high"]);

		const mouse = await mount(() => (
			<ThinkingSelector
				current="medium"
				onSelect={(level) => selected.push(level)}
				onCancel={() => {}}
			/>
		));
		await clickText(mouse, "xhigh");
		expect(selected).toEqual(["high", "xhigh"]);
	});

	test("streaming disables Session switch while rename remains available by mouse", async () => {
		const calls: string[] = [];
		let cancelled = 0;
		const setup = await mount(() => (
			<SessionSettings
				name="Current"
				switchDisabledReason="Unavailable while Pi is streaming"
				onSwitch={() => calls.push("switch")}
				onRename={() => calls.push("rename")}
				onCancel={() => {
					cancelled += 1;
				}}
			/>
		));
		setup.mockInput.pressEnter();
		await setup.flush();
		await clickText(setup, "Switch / resume");
		expect(calls).toEqual([]);
		await clickText(setup, "Rename current session");
		expect(calls).toEqual(["rename"]);
		await clickText(setup, "← Settings");
		expect(cancelled).toBe(1);
	});

	test("rename is prefilled, rejects empty input, and confirms a replacement", async () => {
		const names: string[] = [];
		let cancelled = 0;
		const setup = await mount(() => (
			<SessionRename
				initialName="Prior"
				onConfirm={(name) => names.push(name)}
				onCancel={() => {
					cancelled += 1;
				}}
			/>
		));
		const editor = setup.renderer.root.findDescendantById(
			"settings-session-rename",
		) as TextareaRenderable | undefined;
		expect(editor?.plainText).toBe("Prior");
		editor?.clear();
		await setup.flush();
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(names).toEqual([]);
		expect(setup.captureCharFrame()).toContain("Name cannot be empty.");
		editor?.focus();
		await setup.mockInput.typeText("Updated");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(names).toEqual(["Updated"]);
		await clickText(setup, "← Session");
		expect(cancelled).toBe(1);
	});

	test("rename busy state blocks duplicates and a failure updates in place", async () => {
		const [busy, setBusy] = createSignal(true);
		const [error, setError] = createSignal<string | undefined>();
		const names: string[] = [];
		const setup = await mount(() => (
			<SessionRename
				initialName="Prior"
				busy={busy}
				error={error}
				onConfirm={(name) => names.push(name)}
				onCancel={() => {}}
			/>
		));
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(names).toEqual([]);
		expect(setup.captureCharFrame()).toContain("Applying…");
		setBusy(false);
		setError("Rename rejected");
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("Rename rejected");
	});

	test("theme preset browser lists ten real previews and supports keyboard and mouse", async () => {
		const selected: string[] = [];
		let customize = 0;
		let cancelled = 0;
		const setup = await mount(
			() => (
				<ThemePresetBrowser
					preset="PiTTy Midnight"
					busy={false}
					onPreset={(preset) => selected.push(preset)}
					onCustomize={() => {
						customize += 1;
					}}
					onCancel={() => {
						cancelled += 1;
					}}
				/>
			),
			80,
			24,
		);
		const frame = setup.captureCharFrame();
		for (const name of themePresetNames) expect(frame).toContain(name);
		expect(frame.match(/ Aa /g)).toHaveLength(10);
		setup.mockInput.pressArrow("down");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selected).toEqual(["Catppuccin Mocha"]);
		setup.mockInput.pressKey("c");
		await setup.flush();
		expect(customize).toBe(1);
		await clickText(setup, "Solarized Light");
		expect(selected).toEqual(["Catppuccin Mocha", "Solarized Light"]);
		await clickText(setup, "← Settings");
		expect(cancelled).toBe(1);
	});

	test("theme preset browser disables duplicate actions while saving and keeps errors inline", async () => {
		const selected: string[] = [];
		let customize = 0;
		const setup = await mount(() => (
			<ThemePresetBrowser
				preset="Nord"
				busy
				error="disk full"
				onPreset={(preset) => selected.push(preset)}
				onCustomize={() => {
					customize += 1;
				}}
				onCancel={() => {}}
			/>
		));
		setup.mockInput.pressArrow("down");
		setup.mockInput.pressEnter();
		setup.mockInput.pressKey("c");
		await setup.flush();
		await clickText(setup, "Solarized Light");
		await clickText(setup, "Customize colors");
		expect(selected).toEqual([]);
		expect(customize).toBe(0);
		expect(setup.captureCharFrame()).toContain("Saving…");
	});

	test("theme token editor searches every token and immediately applies complete valid colors", async () => {
		const changes: Array<{ token: string; value: string }> = [];
		const [overrides, setOverrides] = createSignal<Partial<ThemePalette>>({});
		let resets = 0;
		const setup = await mount(
			() => (
				<ThemeTokenEditor
					preset="PiTTy Midnight"
					overrides={overrides}
					busy={false}
					onToken={(token, value) => {
						changes.push({ token, value });
						setOverrides((current) => ({ ...current, [token]: value }));
					}}
					onReset={() => {
						resets += 1;
						setOverrides({});
					}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		await setup.mockInput.typeText("toolRead");
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("toolReadBg");
		setup.mockInput.pressTab();
		setup.mockInput.pressEnter();
		await setup.flush();
		const editor = setup.renderer.root.findDescendantById(
			"theme-token-value",
		) as TextareaRenderable | undefined;
		expect(editor?.plainText).toBe(colors.toolReadBg);
		editor?.clear();
		await setup.mockInput.typeText("#12345");
		await setup.flush();
		expect(changes).toEqual([]);
		expect(setup.captureCharFrame()).toContain(
			"complete color in #RRGGBB form",
		);
		setup.mockInput.pressKey("END");
		await setup.mockInput.typeText("6");
		await setup.flush();
		expect(editor?.plainText).toBe("#123456");
		expect(changes).toEqual([{ token: "toolReadBg", value: "#123456" }]);
		expect(editor?.plainText).toBe("#123456");

		setup.mockInput.pressTab();
		setup.mockInput.pressKey("r", { ctrl: true });
		await setup.flush();
		expect(resets).toBe(1);
		expect(editor?.plainText).toBe(themePresets["PiTTy Midnight"].toolReadBg);
		expect(themeColorTokens).toHaveLength(25);
		for (const token of themeColorTokens)
			expect(filterThemeTokens(token)).toContain(token);
	});

	test("theme token editor blocks busy writes and retains attempted raw input with write errors", async () => {
		const [busy, setBusy] = createSignal(false);
		const [error, setError] = createSignal("");
		const changes: string[] = [];
		const setup = await mount(() => (
			<ThemeTokenEditor
				preset="PiTTy Midnight"
				overrides={{}}
				busy={busy}
				error={error}
				onToken={(_token, value) => changes.push(value)}
				onReset={() => {}}
				onCancel={() => {}}
			/>
		));
		setup.mockInput.pressEnter();
		await setup.flush();
		const editor = setup.renderer.root.findDescendantById(
			"theme-token-value",
		) as TextareaRenderable | undefined;
		editor?.clear();
		await setup.mockInput.typeText("#ABCDEF");
		await setup.flush();
		expect(changes).toEqual(["#ABCDEF"]);
		setBusy(true);
		setError("atomic replace denied");
		await setup.flush();
		expect(editor?.plainText).toBe("#ABCDEF");
		expect(setup.captureCharFrame()).toContain("Saving…");
		setBusy(false);
		await setup.flush();
		expect(setup.captureCharFrame()).toContain("atomic replace denied");
	});

	test("theme token editor reports live low contrast and exposes mouse reset", async () => {
		const lowContrastPalette = {
			...themePresets["PiTTy Midnight"],
			text: "#09090B",
			muted: "#09090B",
		};
		let resets = 0;
		const setup = await mount(() => (
			<ThemeTokenEditor
				preset="PiTTy Midnight"
				overrides={{ text: "#09090B", muted: "#09090B" }}
				palette={lowContrastPalette}
				busy={false}
				onToken={() => {}}
				onReset={() => {
					resets += 1;
				}}
				onCancel={() => {}}
			/>
		));
		const frame = setup.captureCharFrame();
		expect(frame).toContain("primary text text/background");
		expect(frame).toContain(":1");
		await clickText(setup, "Reset to PiTTy Midnight");
		expect(resets).toBe(1);
	});

	test("MCP settings renders install, scope, preview, and activation states without custom panels", async () => {
		const install = createSignal<McpInstallState>("missing");
		const config = createSignal<McpConfigState>("mutation-preview");
		const scope = createSignal<McpScope>("global");
		const snapshot = createSignal<McpConfigSnapshot>({
			scope: "global",
			filePath: "/tmp/mcp.json",
			exists: true,
			sourceFingerprint: "x",
			document: { mcpServers: {} },
			servers: {},
		});
		const view = createSignal<McpSettingsView>("list");
		const setup = await mount(() => (
			<McpSettings
				adapterState={install[0]}
				configState={config[0]}
				scope={scope[0]}
				snapshot={snapshot[0]}
				preview={() => ({
					snapshot: snapshot[0](),
					mutation: { kind: "delete", name: "demo" },
					before: { command: "old" },
					after: undefined,
					document: { mcpServers: {} },
					warnings: [
						"Configured command executes with the user's permissions.",
					],
				})}
				error={() => undefined}
				view={view[0]}
				onViewChange={view[1]}
				onInstall={() => install[1]("installing")}
				onScope={scope[1]}
				onAdd={() => {}}
				onDelete={() => {}}
				onConfirmPreview={() => {}}
				onCancelPreview={() => {}}
				onRetryActivation={() => {}}
				onBack={() => {}}
			/>
		));
		const frame = setup.captureCharFrame();
		const headerLine = frame
			.split("\n")
			.findIndex((line) => line.includes("MCP servers"));
		expect(headerLine).toBeGreaterThanOrEqual(0);
		expect(headerLine).toBeLessThanOrEqual(3);
		expect(frame).toContain("Global changes affect other MCP hosts.");
		expect(frame).toContain("Before/after preview");
		expect(frame).toContain("never invokes /mcp");
	});

	test("MCP settings uses a list-first flow for empty and populated scopes", async () => {
		const emptySnapshot: McpConfigSnapshot = {
			scope: "global",
			filePath: "/tmp/home/.config/mcp/mcp.json",
			exists: false,
			sourceFingerprint: "empty",
			document: { mcpServers: {} },
			servers: {},
		};
		const populatedSnapshot: McpConfigSnapshot = {
			...emptySnapshot,
			exists: true,
			sourceFingerprint: "populated",
			document: {
				mcpServers: {
					demo: { command: "node", args: ["server.js"] },
					remote: { url: "https://example.test/mcp" },
				},
			},
			servers: {
				demo: { command: "node", args: ["server.js"] },
				remote: { url: "https://example.test/mcp" },
			},
			laterPrecedenceNames: ["remote"],
		};
		const view = createSignal<McpSettingsView>("list");
		const common = {
			adapterState: () => "ready" as McpInstallState,
			configState: () => "loaded" as McpConfigState,
			scope: () => "global" as McpScope,
			preview: () => undefined,
			error: () => undefined,
			view: view[0],
			onViewChange: view[1],
			onInstall: () => {},
			onScope: () => {},
			onAdd: () => {},
			onDelete: () => {},
			onConfirmPreview: () => {},
			onCancelPreview: () => {},
			onRetryActivation: () => {},
			onBack: () => {},
		};
		const empty = await mount(() => (
			<McpSettings
				{...common}
				view={view[0]}
				onViewChange={view[1]}
				snapshot={() => emptySnapshot}
			/>
		));
		expect(empty.captureCharFrame()).toContain("No servers in selected scope.");
		expect(empty.captureCharFrame()).toContain("Add server");
		expect(empty.captureCharFrame()).not.toContain("Command (required)");
		const addForm = await mount(() => (
			<McpSettings
				{...common}
				view={() => "form"}
				onViewChange={view[1]}
				snapshot={() => emptySnapshot}
			/>
		));
		expect(addForm.captureCharFrame()).toContain("Command (required)");
		expect(addForm.captureCharFrame()).toContain("Cancel");
		const populated = await mount(() => (
			<McpSettings
				{...common}
				view={view[0]}
				onViewChange={view[1]}
				snapshot={() => populatedSnapshot}
			/>
		));
		const populatedFrame = populated.captureCharFrame();
		expect(populatedFrame).toContain("demo");
		expect(populatedFrame).toContain("stdio");
		expect(populatedFrame).toContain("node server.js");
		expect(populatedFrame).toContain("Configured in global scope");
		expect(populatedFrame).toContain("remote");
		expect(populatedFrame).toContain("HTTP");
		expect(populatedFrame).toContain("https://example.test/mcp");
		expect(populatedFrame).toContain("Later source may override fields");
		expect(populatedFrame).not.toContain("Scoped servers: demo");
		expect(populatedFrame).not.toContain("Command (required)");
	});

	test("footer keeps Settings readable at supported and constrained widths", () => {
		expect(globalFooterHint(104, false)).toBe(
			"ctrl+x settings  ctrl+s sidebar  ctrl+p models",
		);
		expect(globalFooterHint(80, false).length).toBeLessThan(60);
		expect(globalFooterHint(104, true)).toContain("main chat");
		expect(globalFooterHint(104, false, 2)).toContain("ctrl+down inspect");
		expect(globalFooterHint(104, false, 1)).not.toContain("ctrl+←/→ cycle");
	});

	test("maps OpenCode-style subagent navigation shortcuts", () => {
		expect(subagentNavigationAction(false, "down", { ctrl: true })).toBe(
			"inspect",
		);
		expect(subagentNavigationAction(true, "left")).toBe("previous");
		expect(subagentNavigationAction(true, "right", { ctrl: true })).toBe(
			"next",
		);
		expect(subagentNavigationAction(true, "up")).toBe("main");
		expect(subagentNavigationAction(true, "up", { ctrl: true })).toBe("main");
		expect(subagentNavigationAction(false, "down")).toBeUndefined();
	});
});
