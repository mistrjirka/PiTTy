import { describe, expect, test } from "bun:test";
import {
	filterModelChoices,
	formatContextWindow,
	ModelSelectorDialog,
	normalizeModelChoices,
} from "../src/ui/model-selector.tsx";
import { Sidebar } from "../src/ui/sidebar.tsx";
import { REQUEST_TIMING_VERSION, type RequestTiming } from "../src/tabs/request-timing.ts";
import type { RpcSessionState } from "../src/types.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("model selector arrows move one row from the highlighted model", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "openai", id: "beta", name: "Beta" },
			{ provider: "openai", id: "gamma", name: "Gamma" },
			{ provider: "openai", id: "delta", name: "Delta" },
		];
		let selectedModel: string | undefined;
		const setup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				currentProvider="openai"
				currentModelId="gamma"
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		const selectedLine = (frame: string, id: string) =>
			frame.split("\n").find((line) => line.includes(`openai/${id}`));
		expect(selectedLine(setup.captureCharFrame(), "gamma") ?? "").toContain(
			"▶",
		);
		setup.mockInput.pressArrow("down");
		await setup.flush();
		const afterDown = setup.captureCharFrame();
		expect(selectedLine(afterDown, "delta") ?? "").toContain("▶");
		expect(selectedLine(afterDown, "gamma") ?? "").not.toContain("▶");
		setup.mockInput.pressArrow("up");
		setup.mockInput.pressArrow("up");
		await setup.flush();
		const afterUp = setup.captureCharFrame();
		expect(selectedLine(afterUp, "beta") ?? "").toContain("▶");
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selectedModel).toBe("beta");
	});

	test("model selector enter selects the highlighted model from the search box", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "openai", id: "beta", name: "Beta" },
			{ provider: "openai", id: "gamma", name: "Gamma" },
		];
		let selectedModel: string | undefined;
		const setup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				currentProvider="openai"
				currentModelId="gamma"
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		setup.mockInput.pressEnter();
		await setup.flush();
		expect(selectedModel).toBe("gamma");
	});

	test("model selector selects a row on mouse click", async () => {
		const models = [
			{ provider: "openai", id: "alpha", name: "Alpha" },
			{ provider: "anthropic", id: "beta", name: "Beta" },
		];
		let selectedModel: string | undefined;
		const setup = await mount(() => (
			<ModelSelectorDialog
				models={models}
				onSelect={(model) => {
					selectedModel = model.id;
				}}
				onCancel={() => {}}
			/>
		));
		await setup.flush();
		const frame = setup.captureCharFrame();
		const y = frame
			.split("\n")
			.findIndex((line) => line.includes("anthropic/beta"));
		expect(y).toBeGreaterThanOrEqual(0);
		await setup.mockMouse.click(
			Math.max(0, frame.split("\n")[y]!.indexOf("anthropic/beta")),
			y,
		);
		await setup.flush();
		expect(selectedModel).toBe("beta");
	});

	test("normalizes and renders the Ctrl+P model list", async () => {
		const models = normalizeModelChoices([
			{
				provider: "openai-codex",
				id: "gpt-5.6-terra",
				name: "GPT-5.6 Terra",
				contextWindow: 400000,
			},
			{
				provider: "openai-codex",
				id: "gpt-5.6-sol",
				name: "GPT-5.6 Sol",
				contextWindow: 1000000,
			},
			{ provider: "openai-codex", id: "gpt-5.6-sol", name: "duplicate" },
			null,
		]);
		expect(models).toHaveLength(2);
		const setup = await mount(
			() => (
				<ModelSelectorDialog
					models={models}
					currentProvider="openai-codex"
					currentModelId="gpt-5.6-terra"
					performanceHistory={{
						"openai-codex\u0000gpt-5.6-terra": [
							{
								timestamp: Date.now(),
								ttftMs: 800,
								outputTokensPerSecond: 42,
								version: 3,
							},
						],
					}}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toMatch(/Model\s+\d+ match/);
		expect(frame).toContain("openai-codex/gpt-5.6-sol");
		expect(frame).toContain("openai-codex/gpt-5.6-terra");
		expect(frame).toContain("400k ctx");
		expect(frame).toContain("1M ctx");
		expect(frame).toContain("median 42 tok/s · first token 800ms");
		expect(formatContextWindow(128000)).toBe("128k ctx");
		expect(filterModelChoices(models, "SOL").map((model) => model.id)).toEqual([
			"gpt-5.6-sol",
		]);
		expect(
			filterModelChoices(models, "terra").map((model) => model.id),
		).toEqual(["gpt-5.6-terra"]);
		expect(filterModelChoices(models, "/")).toEqual(models);
		expect(filterModelChoices(models, " /  / ")).toEqual(models);
		expect(
			filterModelChoices(models, "openai-codex/gpt-5.6-sol").map(
				(model) => model.id,
			),
		).toEqual(["gpt-5.6-sol"]);
		expect(
			filterModelChoices(models, "codex / terra").map((model) => model.id),
		).toEqual(["gpt-5.6-terra"]);
		expect(filterModelChoices(models, "missing")).toEqual([]);
		const emptySetup = await mount(
			() => (
				<ModelSelectorDialog
					models={[]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			16,
		);
		expect(emptySetup.captureCharFrame()).toContain("0 matches");
		expect(emptySetup.captureCharFrame()).toContain("No matching models.");
	});

	test("Ctrl+P slash alone keeps all models visible instead of clearing results", async () => {
		const setup = await mount(
			() => (
				<ModelSelectorDialog
					models={[
						{ provider: "openai-codex", id: "gpt-5.6-terra" },
						{ provider: "anthropic", id: "claude-sonnet" },
					]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			24,
		);
		await setup.mockInput.typeText("/");
		await setup.flush();
		const frame = setup.captureCharFrame();
		expect(frame).toContain("2 matches");
		expect(frame).toContain("openai-codex/gpt-5.6-terra");
		expect(frame).toContain("anthropic/claude-sonnet");
		expect(frame).not.toContain("No matching models.");
	});

	test("model selector shows the Pi sync notice when set", async () => {
		const setup = await mount(
			() => (
				<ModelSelectorDialog
					models={[]}
					notice="syncing with Pi…"
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			90,
			16,
		);
		expect(setup.captureCharFrame()).toContain("syncing with Pi…");
	});

	test("omits detailed tool timings from the model picker", async () => {
		const history: RequestTiming[] = [
			{
				timingVersion: REQUEST_TIMING_VERSION,
				provider: "openai",
				modelId: "gpt",
				turnMs: 7_200,
				toolCallDurationsMs: [980],
				toolDispatchMs: [55],
				toolCallCount: 1,
			},
		];
		const setup = await mount(
			() => (
				<ModelSelectorDialog
					models={[{ provider: "openai", id: "gpt" }]}
					timingHistory={history}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			75,
			20,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("openai/gpt");
		expect(frame).not.toContain("Tool 980ms");
		expect(frame).not.toContain("Dispatch 55ms");
	});

	test("does not display another model's last measured output speed", async () => {
		const setup = await mount(
			() => (
				<Sidebar
					state={
						{
							sessionName: "Running",
							model: {
								provider: "openai",
								id: "new-model",
								contextWindow: 100000,
							},
						} as RpcSessionState
					}
					runs={[]}
					lastRequestPerformance={{
						provider: "openai",
						modelId: "old-model",
						ttftMs: 100,
						outputTokens: 100,
						generationMs: 1000,
					}}
					subagentsAvailable={false}
					height={24}
				/>
			),
			80,
			24,
		);
		expect(setup.captureCharFrame()).not.toContain("tok/s");
	});

	test("hides timing until the selected model has produced a request", async () => {
		const setup = await mount(
			() => (
				<Sidebar
					state={
						{
							sessionName: "Timing session",
							sessionId: "session",
							model: {
								provider: "openai",
								id: "gpt-4",
								contextWindow: 100_000,
							},
							thinkingLevel: "high",
						} as RpcSessionState
					}
					runs={[]}
					subagentsAvailable={false}
					height={24}
				/>
			),
			80,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).not.toContain("· Tool");
		expect(frame).not.toContain("Turn");
	});

	test("keeps the main draft visible beneath the selector reservation", async () => {
		const setup = await mount(
			() => (
				<box width="100%" height="100%" flexDirection="column">
					<box flexGrow={1} />
					<textarea
						ref={(value) => {
							value.setText("unsent draft");
						}}
						height={4}
						minHeight={4}
					/>
					<ModelSelectorDialog
						models={[{ provider: "local", id: "draft-model" }]}
						onSelect={() => {}}
						onCancel={() => {}}
					/>
				</box>
			),
			70,
			14,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("unsent draft");
		expect(frame).toContain("Search provider");
	});
});
