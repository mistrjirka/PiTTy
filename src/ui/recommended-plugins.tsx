/** Settings page that installs the recommended plugins via founder setup. */
import { useKeyboard } from "@opentui/solid";
import { createSignal, For, Match, onCleanup, Switch } from "solid-js";
import {
	type FoundersPlanEntry,
	foundersFailureMessage,
	parseFoundersPlan,
	runFoundersSetup,
} from "../tabs/founders-setup-runner.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors } from "./theme.ts";

export type RecommendedPluginsState =
	| { kind: "checking" }
	| { kind: "ready"; plan: FoundersPlanEntry[] }
	| { kind: "installing"; plan: FoundersPlanEntry[] }
	| { kind: "installed"; customAgentsKept: boolean }
	| { kind: "failed"; message: string; logPath: string };

export function pendingPlanCount(plan: readonly FoundersPlanEntry[]): number {
	return plan.filter((entry) => entry.action !== "present").length;
}

const ACTION_MARK: Record<FoundersPlanEntry["action"], { glyph: string; word: string }> = {
	present: { glyph: "✓", word: "installed" },
	install: { glyph: "+", word: "install" },
	configure: { glyph: "~", word: "enable" },
};

function PlanRows(props: { plan: readonly FoundersPlanEntry[] }) {
	return (
		<For each={props.plan}>
			{(entry) => (
				<box height={1} flexDirection="row" flexShrink={0}>
					<text
						fg={entry.action === "present" ? colors.green : colors.accent}
						wrapMode="none"
						flexShrink={0}
					>
						{`${ACTION_MARK[entry.action].glyph} `}
					</text>
					<text fg={colors.text} wrapMode="none" flexShrink={1}>
						{entry.name}
					</text>
					<box flexGrow={1} minWidth={2} />
					<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
						{ACTION_MARK[entry.action].word}
					</text>
				</box>
			)}
		</For>
	);
}

export function RecommendedPlugins(props: {
	onBack: () => void;
	/** Injected in tests; the app runs the real setup script. */
	run?: typeof runFoundersSetup;
}) {
	const run = props.run ?? runFoundersSetup;
	const [state, setState] = createSignal<RecommendedPluginsState>({ kind: "checking" });
	let mounted = true;
	// Newest run wins: a dry-run that finishes after an install started must
	// not overwrite the install's state.
	let runId = 0;
	onCleanup(() => {
		mounted = false;
	});

	const check = () => {
		const id = ++runId;
		setState({ kind: "checking" });
		void run("dry-run").then((result) => {
			if (!mounted || id !== runId) return;
			const plan = parseFoundersPlan(result.output);
			setState(
				result.exitCode === 0 && plan.length > 0
					? { kind: "ready", plan }
					: { kind: "failed", message: foundersFailureMessage(result.output), logPath: result.logPath },
			);
		});
	};
	const install = () => {
		const current = state();
		if (current.kind !== "ready" || pendingPlanCount(current.plan) === 0) return;
		const id = ++runId;
		setState({ kind: "installing", plan: current.plan });
		void run("install").then((result) => {
			if (!mounted || id !== runId) return;
			// Exit 2: everything installed, but a custom agent file with a
			// curated name was kept instead of replaced.
			setState(
				result.exitCode === 0 || result.exitCode === 2
					? { kind: "installed", customAgentsKept: result.exitCode === 2 }
					: { kind: "failed", message: foundersFailureMessage(result.output), logPath: result.logPath },
			);
		});
	};
	check();

	useKeyboard((event) => {
		if (event.eventType === "release") return;
		if (event.name !== "enter" && event.name !== "return") return;
		const current = state();
		if (current.kind === "ready") install();
		else if (current.kind === "failed") check();
		else return;
		event.preventDefault();
		event.stopPropagation();
	});

	// Named narrowings for <Match>: each returns the state only in its kinds.
	const planState = () => {
		const current = state();
		return current.kind === "ready" || current.kind === "installing" ? current : undefined;
	};
	const installedState = () => {
		const current = state();
		return current.kind === "installed" ? current : undefined;
	};
	const failedState = () => {
		const current = state();
		return current.kind === "failed" ? current : undefined;
	};

	const summary = () => {
		const current = state();
		if (current.kind === "ready") {
			const pending = pendingPlanCount(current.plan);
			return pending === 0 ? "all installed" : `${pending} to install`;
		}
		if (current.kind === "installing") return "installing…";
		return undefined;
	};
	const hint = () => {
		const current = state();
		if (current.kind === "ready" && pendingPlanCount(current.plan) > 0) return "enter install";
		if (current.kind === "failed") return "enter retry";
		return undefined;
	};

	return (
		<DialogFrame
			id="recommended-plugins"
			title="Recommended plugins"
			summary={summary()}
			hint={hint()}
			closeLabel="esc ‹ settings"
			onClose={props.onBack}
		>
			<Switch>
				<Match when={state().kind === "checking"}>
					<text fg={colors.muted}>Checking installed plugins…</text>
				</Match>
				<Match when={planState()}>
					{(current) => (
						<box flexDirection="column">
							<PlanRows plan={current().plan} />
							<box height={1} />
							<text fg={colors.subtle} wrapMode="word">
								{current().kind === "installing"
									? "Installing. This can take a few minutes."
									: "Subagents, compaction, memory, BTW side questions, curated skills and agents, and tools. Credentials and model defaults stay unchanged."}
							</text>
						</box>
					)}
				</Match>
				<Match when={installedState()}>
					{(current) => (
						<box flexDirection="column">
							<text fg={colors.green}>Installed. Restart PiTTy to load the plugins.</text>
							{current().customAgentsKept ? (
								<text fg={colors.yellow} wrapMode="word">
									Some custom agent files kept their names; curated copies were skipped.
								</text>
							) : null}
						</box>
					)}
				</Match>
				<Match when={failedState()}>
					{(current) => (
						<box flexDirection="column">
							<text fg={colors.red} wrapMode="word">{current().message}</text>
							<text fg={colors.subtle} wrapMode="char">{`Log: ${current().logPath}`}</text>
						</box>
					)}
				</Match>
			</Switch>
		</DialogFrame>
	);
}
