import * as fs from "node:fs";
import * as path from "node:path";
import type { SubagentRun, SubagentStep, ToolItem } from "../types.ts";
import { subagentActivityAt } from "./transcript.ts";
import { childRunIdFromSessionFile } from "./artifacts.ts";

export type SubagentTarget = {
	key: string;
	run: SubagentRun;
	step?: SubagentStep | undefined;
	stepIndex?: number | undefined;
	label: string;
	state: string;
	active: boolean;
	canSteer: boolean;
	transcriptPath?: string | undefined;
	sessionFile?: string | undefined;
	startedAt?: number | undefined;
	lastUpdate?: number | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	contextWindow?: number | undefined;
	toolCallId?: string | undefined;
	workflowKey?: string | undefined;
	parentWorkflowRunId?: string | undefined;
	childRunId?: string | undefined;
	error?: string | undefined;
};

type ChildArtifactMetadata = {
	model?: string;
	thinking?: string;
	contextWindow?: number;
	error?: string;
};

function childArtifactMetadata(
	run: SubagentRun,
	step: SubagentStep,
): ChildArtifactMetadata {
	const childRunId = step.runId;
	const agent = step.agent.trim();
	if (!childRunId || !agent || step.workflowKey === undefined) return {};
	const fileName = `${childRunId}_${agent.replace(/[^\w.-]/g, "_")}_${step.index}_meta.json`;
	const candidates = new Set<string>();
	if (step.transcriptPath?.endsWith("_transcript.jsonl")) {
		candidates.add(
			step.transcriptPath.slice(0, -"_transcript.jsonl".length) + "_meta.json",
		);
	}
	if (step.sessionFile) {
		const sessionDir = path.dirname(
			path.dirname(path.dirname(path.dirname(step.sessionFile))),
		);
		candidates.add(path.join(sessionDir, "subagent-artifacts", fileName));
	}
	if (run.cwd)
		candidates.add(path.join(run.cwd, ".pi", "subagents", "artifacts", fileName));
	for (const candidate of candidates) {
		let raw: unknown;
		try {
			raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
		} catch {
			continue;
		}
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const meta = raw as Record<string, unknown>;
		const metaWorkflowKey =
			typeof meta.workflowKey === "string"
				? meta.workflowKey
				: typeof meta.key === "string"
					? meta.key
					: undefined;
		const metaAgent = typeof meta.agent === "string" ? meta.agent : undefined;
		const metaIndex =
			typeof meta.index === "number"
				? meta.index
				: typeof meta.childIndex === "number"
					? meta.childIndex
					: undefined;
		if (
			metaWorkflowKey !== step.workflowKey ||
			metaAgent !== agent ||
			metaIndex !== step.index
		)
			continue;
		return {
			...(typeof meta.model === "string" && meta.model.trim()
				? { model: meta.model.trim() }
				: {}),
			...(typeof meta.thinking === "string" && meta.thinking.trim()
				? { thinking: meta.thinking.trim() }
				: {}),
			...(typeof meta.contextWindow === "number" &&
			Number.isFinite(meta.contextWindow)
				? { contextWindow: meta.contextWindow }
				: {}),
			...(typeof meta.error === "string" && meta.error.trim()
				? { error: meta.error.trim() }
				: typeof meta.errorMessage === "string" && meta.errorMessage.trim()
					? { error: meta.errorMessage.trim() }
					: {}),
		};
	}
	return {};
}

function activeState(value: string | undefined): boolean {
	return (
		value === "pending" ||
		value === "running" ||
		value === "queued" ||
		value === "active" ||
		value === "working"
	);
}

function targetLabel(
	run: SubagentRun,
	step?: SubagentStep,
	requested?: RequestedMetadata,
): string {
	if (step) {
		const child = run.steps.length > 1 ? ` #${step.index + 1}` : "";
		const agent = step.agent || requested?.agent || run.agent || run.mode;
		const detail = step.label ?? step.phase ?? requested?.label;
		return detail ? `${agent}${child} · ${detail}` : `${agent}${child}`;
	}
	return (
		run.agent ??
		run.agents?.join(", ") ??
		requested?.label ??
		requested?.agent ??
		run.mode
	);
}

type ForegroundEntry = {
	progress: Record<string, unknown>;
	result?: Record<string, unknown> | undefined;
	identity?: string | undefined;
	workflow?: boolean | undefined;
};

type RequestedMetadata = {
	label?: string;
	agent?: string;
	model?: string;
	thinking?: string;
	contextWindow?: number;
};

function requestedChildren(args: unknown): RequestedMetadata[] {
	const root = record(args);
	if (!root) return [];
	const children: Record<string, unknown>[] = [];
	const tasks = Array.isArray(root.tasks) ? root.tasks : undefined;
	if (tasks) {
		for (const value of tasks) {
			const task = record(value);
			if (!task) continue;
			const count =
				typeof task.count === "number" &&
				Number.isInteger(task.count) &&
				task.count > 0 &&
				task.count <= 100
					? task.count
					: 1;
			for (let index = 0; index < count; index++) children.push(task);
		}
	} else if (Array.isArray(root.chain)) {
		for (const value of root.chain) {
			const step = record(value);
			if (!step) continue;
			if (Array.isArray(step.parallel)) {
				for (const child of step.parallel) {
					const task = record(child);
					if (task) children.push(task);
				}
			} else {
				children.push(step);
			}
		}
	} else if (Array.isArray(root.parallel)) {
		for (const value of root.parallel) {
			const task = record(value);
			if (task) children.push(task);
		}
	} else {
		children.push(root);
	}
	return children.map((child) => ({
		...(typeof child.label === "string" && child.label.trim()
			? { label: child.label.trim() }
			: {}),
		...(typeof child.agent === "string" && child.agent.trim()
			? { agent: child.agent.trim() }
			: {}),
		...(typeof child.model === "string" && child.model.trim()
			? { model: child.model.trim() }
			: {}),
		...(typeof child.thinking === "string" && child.thinking.trim()
			? { thinking: child.thinking.trim() }
			: {}),
		...(typeof child.contextWindow === "number" &&
		Number.isFinite(child.contextWindow)
			? { contextWindow: child.contextWindow }
			: {}),
	}));
}

function meaningfulResult(result: Record<string, unknown>): boolean {
	const stringFields = [
		"agent",
		"label",
		"status",
		"transcriptPath",
		"sessionFile",
		"model",
		"thinking",
	];
	for (const field of stringFields) {
		const value = result[field];
		if (typeof value === "string" && value.trim().length > 0) return true;
	}
	return ["exitCode", "contextWindow", "turnCount", "toolCount"].some(
		(field) =>
			typeof result[field] === "number" && Number.isFinite(result[field]),
	);
}

function workflowIdentity(value: Record<string, unknown>): string | undefined {
	// Workflow keys are stable across the child lifecycle; runId is only added
	// to terminal trace entries and therefore must not replace the key.
	for (const key of ["workflowKey", "key", "childId", "runId", "id"] as const) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim())
			return candidate.trim();
	}
	return undefined;
}

function workflowTrace(details: Record<string, unknown>): ForegroundEntry[] {
	const workflow = record(details.workflow);
	const trace = workflow?.trace;
	if (!Array.isArray(trace)) return [];
	const latest = new Map<string, ForegroundEntry>();
	trace.forEach((value, index) => {
		const entry = record(value);
		if (!entry || entry.operation !== "run") return;
		const run = record(entry.run) ?? entry;
		if (Object.keys(run).length === 0) return;
		const identity =
			workflowIdentity(entry) ?? workflowIdentity(run) ?? `index:${index}`;
		const previous = latest.get(identity);
		// Trace updates can be sparse. Retain metadata from the first event while
		// allowing later state/timing fields to advance the same logical row.
		latest.set(identity, {
			progress: { ...(previous?.progress ?? {}), ...run },
			identity,
			workflow: true,
		});
	});
	return [...latest.values()];
}

function foregroundProgressState(
	progress: Record<string, unknown>,
): string | undefined {
	const state = typeof progress.state === "string" ? progress.state : undefined;
	if (state)
		return state === "started" || state === "reused" ? "running" : state;
	const status =
		typeof progress.status === "string" ? progress.status : undefined;
	if (status)
		return status === "started" || status === "reused" ? "running" : status;
	const event =
		typeof progress.event === "string"
			? progress.event
			: typeof progress.type === "string"
				? progress.type
				: undefined;
	return event === "started" || event === "reused" ? "running" : undefined;
}

function foregroundEntries(item: ToolItem): readonly ForegroundEntry[] {
	const details = record(item.details);
	const traceEntries = details ? workflowTrace(details) : [];
	const results = details?.results;
	if (Array.isArray(results)) {
		const entries = results
			.flatMap((value): ForegroundEntry[] => {
				const result = record(value);
				if (!result) return [];
				const nested = result.progress;
				const nestedRecord = record(nested);
				const hasProgress = Array.isArray(nested)
					? nested.some((value) => {
							const progress = record(value);
							return progress !== undefined && Object.keys(progress).length > 0;
						})
					: nestedRecord !== undefined && Object.keys(nestedRecord).length > 0;
				if (!meaningfulResult(result) && !hasProgress) return [];
				if (Array.isArray(nested)) {
					const progress = nested.flatMap(
						(progressValue): Record<string, unknown>[] => {
							const entry = record(progressValue);
							return entry ? [entry] : [];
						},
					);
					return progress.length > 0
						? progress.map((entry) => ({ progress: entry, result }))
						: meaningfulResult(result)
							? [{ progress: {}, result }]
							: [];
				}
				const progressRecord = record(nested);
				return progressRecord && Object.keys(progressRecord).length > 0
					? [{ progress: progressRecord, result }]
					: [{ progress: {}, result }];
			})
			.map((entry) => {
				const identity = entry.identity ?? workflowIdentity(entry.result ?? {});
				return identity ? { ...entry, identity } : entry;
			});
		if (entries.length > 0) {
			if (traceEntries.length === 0) return entries;
			const byIdentity = new Map<string, ForegroundEntry>();
			for (const entry of entries) {
				if (entry.identity !== undefined && !byIdentity.has(entry.identity))
					byIdentity.set(entry.identity, entry);
			}
			const byRunId = new Map<string, ForegroundEntry>();
			for (const entry of entries) {
				const runId =
					typeof entry.result?.runId === "string" && entry.result.runId.trim()
						? entry.result.runId.trim()
						: childRunIdFromSessionFile(entry.result?.sessionFile);
				if (!runId) continue;
				const existing = byRunId.get(runId);
				if (!existing) {
					byRunId.set(runId, entry);
					continue;
				}
				// One child run can yield several result entries (e.g. resumed
				// runs); keep the lowest-indexed one as the representative.
				const entryIndex =
					typeof entry.result?.index === "number"
						? entry.result.index
						: Number.MAX_SAFE_INTEGER;
				const existingIndex =
					typeof existing.result?.index === "number"
						? existing.result.index
						: Number.MAX_SAFE_INTEGER;
				if (entryIndex < existingIndex) byRunId.set(runId, entry);
			}
			const used = new Set<string>();
			const positional =
				entries.length === traceEntries.length &&
				entries.every(
					(entry) =>
						entry.result !== undefined &&
						typeof entry.result.index === "number" &&
						workflowIdentity(entry.result) === undefined,
				) &&
				traceEntries.every((trace, index) => {
					const result = entries[index]?.result;
					const traceAgent = trace.progress.agent;
					const resultAgent = result?.agent;
					return (
						typeof traceAgent !== "string" ||
						typeof resultAgent !== "string" ||
						traceAgent === resultAgent
					);
				});
			const merged = traceEntries.map((trace, index) => {
				const identity = trace.identity;
				const traceRunId = trace.progress.runId;
				const terminal =
					(identity !== undefined ? byIdentity.get(identity) : undefined) ??
					(typeof traceRunId === "string"
						? byRunId.get(traceRunId.trim())
						: undefined) ??
					(positional ? entries[index] : undefined);
				if (terminal && terminal.identity !== undefined)
					used.add(terminal.identity);
				if (!terminal) return trace;
				return {
					...trace,
					progress: { ...trace.progress, ...terminal.progress },
					result: terminal.result,
					identity,
				};
			});
			for (const [key, terminal] of byIdentity) {
				if (!used.has(key)) merged.push(terminal);
			}
			return merged;
		}
	}
	if (traceEntries.length > 0) return traceEntries;
	const directProgress = details?.progress;
	if (!Array.isArray(directProgress)) return [];
	return directProgress.flatMap((value): ForegroundEntry[] => {
		const progress = record(value);
		return progress && Object.keys(progress).length > 0 ? [{ progress }] : [];
	});
}

function foregroundTargets(item: ToolItem): SubagentTarget[] {
	if (!/subagent|delegate|agent/i.test(item.name)) return [];
	const details = record(item.details);
	const entries = foregroundEntries(item);
	const requested = requestedChildren(item.args);
	if (entries.length === 0) return [];
	return entries.map(({ progress, result, identity, workflow }, index) => {
		const requestedMetadata =
			requested.length === entries.length
				? requested[index]
				: requested.length === 1
					? requested[0]
					: undefined;
		const exitCode =
			typeof result?.exitCode === "number" ? result.exitCode : undefined;
		const terminalState =
			item.status === "done" && exitCode !== undefined
				? exitCode === 0
					? "completed"
					: "failed"
				: undefined;
		const progressStatus = foregroundProgressState(progress);
		const state = workflow
			? (terminalState ?? progressStatus ?? item.status)
			: (progressStatus ?? terminalState ?? item.status);
		const label =
			typeof progress.label === "string"
				? progress.label
				: typeof progress.agent === "string"
					? progress.agent
					: typeof result?.label === "string"
						? result.label
						: typeof result?.agent === "string"
							? result.agent
							: (requestedMetadata?.label ??
								requestedMetadata?.agent ??
								(workflow ? workflowIdentity(progress) : undefined) ??
								"foreground subagent");
		const runId = identity
			? `${item.toolCallId}:${identity}`
			: `${item.toolCallId}:${index}`;
		const workflowKey = workflow
			? typeof progress.workflowKey === "string"
				? progress.workflowKey
				: typeof progress.key === "string"
					? progress.key
					: undefined
			: undefined;
		const parentWorkflowRunId =
			workflow && typeof details?.runId === "string" ? details.runId : undefined;
		const childRunId =
			workflow && typeof progress.runId === "string" ? progress.runId : undefined;
		const tokens = record(progress.tokens);
		const numericTokens =
			typeof progress.tokens === "number" && Number.isFinite(progress.tokens)
				? progress.tokens
				: undefined;
		const transcriptPath =
			typeof result?.transcriptPath === "string"
				? result.transcriptPath
				: typeof progress.transcriptPath === "string"
					? progress.transcriptPath
					: undefined;
		const sessionFile =
			typeof result?.sessionFile === "string"
				? result.sessionFile
				: typeof progress.sessionFile === "string"
					? progress.sessionFile
					: undefined;
		const run: SubagentRun = {
			runId,
			control: "foreground",
			mode: "foreground",
			state,
			agent: label,
			steps: [],
			startedAt: item.startedAt ?? item.timestamp,
			lastUpdate:
				typeof progress.lastActivityAt === "number"
					? progress.lastActivityAt
					: (item.endedAt ?? item.timestamp),
			lastActivityAt:
				typeof progress.lastActivityAt === "number"
					? progress.lastActivityAt
					: undefined,
			currentTool:
				typeof progress.currentTool === "string" ? progress.currentTool : undefined,
			activityState:
				typeof progress.activityState === "string" ? progress.activityState : state,
			currentPath:
				typeof progress.currentPath === "string" ? progress.currentPath : undefined,
			transcriptPath,
			sessionFile,
			turnCount:
				typeof progress.turnCount === "number" ? progress.turnCount : undefined,
			toolCount:
				typeof progress.toolCount === "number" ? progress.toolCount : undefined,
			totalTokens:
				typeof progress.totalTokens === "number"
					? progress.totalTokens
					: (numericTokens ??
						(typeof tokens?.total === "number" ? tokens.total : undefined)),
			...(typeof result?.model === "string"
				? { model: result.model }
				: typeof progress.model === "string"
					? { model: progress.model }
					: requestedMetadata?.model
						? { model: requestedMetadata.model }
						: {}),
			...(typeof result?.thinking === "string"
				? { thinking: result.thinking }
				: typeof progress.thinking === "string"
					? { thinking: progress.thinking }
					: requestedMetadata?.thinking
						? { thinking: requestedMetadata.thinking }
						: {}),
			...(typeof result?.contextWindow === "number"
				? { contextWindow: result.contextWindow }
				: typeof progress.contextWindow === "number"
					? { contextWindow: progress.contextWindow }
					: requestedMetadata?.contextWindow !== undefined
						? { contextWindow: requestedMetadata.contextWindow }
						: {}),
		};
		return {
			key: runId,
			run,
			label,
			state,
			active: activeState(state),
			canSteer: false,
			transcriptPath,
			sessionFile,
			startedAt: run.startedAt,
			lastUpdate: run.lastUpdate,
			stepIndex: index,
			toolCallId: item.toolCallId,
			model: run.model,
			thinking: run.thinking,
			contextWindow: run.contextWindow,
			workflowKey,
			parentWorkflowRunId,
			childRunId,
		};
	});
}

export function subagentTargets(
	runs: readonly SubagentRun[],
	tools: readonly ToolItem[] = [],
): SubagentTarget[] {
	const result: SubagentTarget[] = [];
	const requestedByArtifactId = new Map<string, RequestedMetadata[]>();
	const emptyWorkflowIds = new Set<string>();
	for (const run of runs) {
		if (run.mode !== "workflow" || run.steps.length > 0) continue;
		for (const identifier of [run.runId, run.asyncId, run.asyncDir]) {
			if (identifier) emptyWorkflowIds.add(identifier);
		}
	}
	const fallbackWorkflowIds = new Set<string>();
	const workflowParents = runs.filter(
		(run) => run.mode === "workflow" && run.steps.length > 0,
	);
	const suppressedChildRuns = new Set<string>();
	const enrichedWorkflowParents = new Map<string, SubagentRun>();
	for (const parent of workflowParents) {
		const children = runs.filter(
			(run) =>
				run.parentWorkflowRunId === parent.runId &&
				parent.steps.some((step) => {
					const workflowKey = run.workflowKey ?? run.steps[0]?.workflowKey;
					return (
						(workflowKey !== undefined && step.workflowKey === workflowKey) ||
						(step.runId !== undefined && step.runId === run.runId)
					);
				}),
		);
		const enrichedSteps = parent.steps.map((step) => {
			const matches = children.filter((child) => {
				const workflowKey = child.workflowKey ?? child.steps[0]?.workflowKey;
				return (
					(step.runId !== undefined && step.runId === child.runId) ||
					(step.workflowKey !== undefined && step.workflowKey === workflowKey)
				);
			});
			if (matches.length !== 1) return step;
			const child = matches[0];
			if (!child) return step;
			const childStep = child.steps.length === 1 ? child.steps[0] : undefined;
			const sessionFile =
				step.sessionFile ?? child.sessionFile ?? childStep?.sessionFile;
			const transcriptPath =
				step.transcriptPath ?? child.transcriptPath ?? childStep?.transcriptPath;
			if (
				sessionFile === step.sessionFile &&
				transcriptPath === step.transcriptPath
			)
				return step;
			return { ...step, sessionFile, transcriptPath };
		});
		if (enrichedSteps.some((step, index) => step !== parent.steps[index])) {
			enrichedWorkflowParents.set(parent.runId, {
				...parent,
				steps: enrichedSteps,
			});
		}
	}
	for (const run of runs) {
		if (!run.parentWorkflowRunId) continue;
		const parent = workflowParents.find(
			(candidate) => candidate.runId === run.parentWorkflowRunId,
		);
		if (!parent) continue;
		const workflowKey = run.workflowKey ?? run.steps[0]?.workflowKey;
		if (
			parent.steps.some(
				(step) =>
					(workflowKey !== undefined && step.workflowKey === workflowKey) ||
					(step.runId !== undefined && step.runId === run.runId),
			)
		)
			suppressedChildRuns.add(run.runId);
	}
	const asyncIds = new Set(
		runs
			.filter((run) => run.control !== "mission")
			.flatMap((run) =>
				[run.runId, run.asyncId, run.asyncDir].filter(
					(value): value is string =>
						typeof value === "string" && value.trim().length > 0,
				),
			),
	);
	for (const item of tools) {
		const details = record(item.details);
		const identifiers = [
			details?.runId,
			details?.asyncId,
			details?.asyncDir,
		].filter(
			(value): value is string =>
				typeof value === "string" && value.trim().length > 0,
		);
		const requested = requestedChildren(item.args);
		for (const identifier of identifiers) {
			if (requested.length > 0) requestedByArtifactId.set(identifier, requested);
		}
	}
	for (const item of tools) {
		const details = record(item.details);
		const identifiers = [
			details?.runId,
			details?.asyncId,
			details?.asyncDir,
		].filter(
			(value): value is string =>
				typeof value === "string" && value.trim().length > 0,
		);
		if (!identifiers.some((identifier) => asyncIds.has(identifier))) {
			result.push(...foregroundTargets(item));
		} else if (
			identifiers.some((identifier) => emptyWorkflowIds.has(identifier))
		) {
			const fallback = foregroundTargets(item);
			if (fallback.length > 0) {
				result.push(...fallback);
				for (const identifier of identifiers) {
					if (emptyWorkflowIds.has(identifier)) fallbackWorkflowIds.add(identifier);
				}
			}
		}
	}
	for (const sourceRun of runs) {
		if (suppressedChildRuns.has(sourceRun.runId)) continue;
		const run = enrichedWorkflowParents.get(sourceRun.runId) ?? sourceRun;
		const runIdentifiers = [run.runId, run.asyncId, run.asyncDir].filter(
			(identifier): identifier is string => identifier !== undefined,
		);
		const requested = runIdentifiers
			.map((identifier) => requestedByArtifactId.get(identifier))
			.find((metadata): metadata is RequestedMetadata[] => metadata !== undefined);
		if (run.steps.length > 0) {
			for (const step of run.steps) {
				const artifactMetadata = childArtifactMetadata(run, step);
				const requestedMetadata =
					requested &&
					(requested.length === run.steps.length
						? requested[step.index]
						: requested.length === 1
							? requested[0]
							: undefined);
				const active = activeState(step.activityState) || activeState(step.status);
				const sessionFile = step.sessionFile ?? run.sessionFile;
				result.push({
					key:
						run.control === "mission" && step.workflowKey
							? `${run.runId}:${step.workflowKey}`
							: `${run.runId}:${step.index}`,
					run,
					step,
					stepIndex: step.index,
					label: targetLabel(run, step, requestedMetadata),
					state: step.status,
					active,
					// pi-subagents accepts file-backed steering for running and queued
					// indexed children. It does not require the child session file to
					// exist yet, so queued parallel children remain steerable.
					canSteer: run.control !== "mission" && active && Boolean(run.asyncDir),
					transcriptPath: step.transcriptPath ?? run.transcriptPath,
					sessionFile,
					startedAt: step.startedAt ?? run.startedAt,
					lastUpdate: subagentActivityAt(run, step.index),
					model:
						step.model ??
						run.model ??
						requestedMetadata?.model ??
						artifactMetadata.model,
					thinking:
						step.thinking ??
						run.thinking ??
						requestedMetadata?.thinking ??
						artifactMetadata.thinking,
					contextWindow:
						step.contextWindow ??
						run.contextWindow ??
						requestedMetadata?.contextWindow ??
						artifactMetadata.contextWindow,
					error: step.error ?? run.error ?? artifactMetadata.error,
					workflowKey: step.workflowKey ?? run.workflowKey,
					parentWorkflowRunId: step.parentWorkflowRunId ?? run.parentWorkflowRunId,
					childRunId: step.runId,
				});
			}
			continue;
		}
		if (
			run.mode === "workflow" &&
			runIdentifiers.some((identifier) => fallbackWorkflowIds.has(identifier))
		)
			continue;

		const active = activeState(run.activityState) || activeState(run.state);
		result.push({
			key: run.runId,
			run,
			label: targetLabel(
				run,
				undefined,
				requested?.length === 1 ? requested[0] : undefined,
			),
			state: run.state,
			active,
			canSteer: active && Boolean(run.asyncDir),
			transcriptPath: run.transcriptPath,
			sessionFile: run.sessionFile,
			childRunId: run.runId,
			startedAt: run.startedAt,
			lastUpdate: subagentActivityAt(run),
			model:
				run.model ?? (requested?.length === 1 ? requested[0]?.model : undefined),
			thinking:
				run.thinking ??
				(requested?.length === 1 ? requested[0]?.thinking : undefined),
			contextWindow:
				run.contextWindow ??
				(requested?.length === 1 ? requested[0]?.contextWindow : undefined),
			workflowKey: run.workflowKey,
			parentWorkflowRunId: run.parentWorkflowRunId,
		});
	}

	// Foreground workflow traces contain lifecycle identity but often omit the
	// child session metadata. Prefer an exact file-backed step when its stable
	// workflow key or child runId is present, and make that richer target belong
	// to the workflow tool so ownership does not render both rows.
	const foreground = result.filter(
		(target) =>
			target.run.control === "foreground" &&
			(target.workflowKey !== undefined || target.childRunId !== undefined),
	);
	const persisted = result.filter(
		(target) =>
			target.run.control !== "foreground" &&
			(target.workflowKey !== undefined || target.childRunId !== undefined),
	);
	const matched = new Set<SubagentTarget>();
	for (const trace of foreground) {
		const available = (predicate: (target: SubagentTarget) => boolean) =>
			persisted.filter((target) => !matched.has(target) && predicate(target));
		let candidates =
			trace.childRunId === undefined
				? []
				: available(
						(target) =>
							target.childRunId === trace.childRunId &&
							target.parentWorkflowRunId === trace.parentWorkflowRunId,
					);
		let match = candidates.length === 1 ? candidates[0] : undefined;
		if (!match && trace.workflowKey !== undefined) {
			candidates = available(
				(target) =>
					target.workflowKey === trace.workflowKey &&
					target.parentWorkflowRunId === trace.parentWorkflowRunId,
			);
			match = candidates.length === 1 ? candidates[0] : undefined;
		}
		if (!match) continue;
		matched.add(match);
		const merged: SubagentTarget = {
			...match,
			...(match.step ? { step: { ...match.step, status: trace.state } } : {}),
			key: trace.key,
			state: trace.state,
			active: trace.active,
			canSteer: trace.canSteer,
			toolCallId: trace.toolCallId,
			run: {
				...match.run,
				state: trace.run.state,
				...(trace.run.activityState !== undefined
					? { activityState: trace.run.activityState }
					: {}),
			},
		};
		const index = result.indexOf(match);
		if (index >= 0) result[index] = merged;
		const traceIndex = result.indexOf(trace);
		if (traceIndex >= 0) result.splice(traceIndex, 1);
	}

	const deduped = new Map<string, SubagentTarget>();
	for (const target of result) {
		const identity = subagentTargetIdentity(target);
		const existing = deduped.get(identity);
		if (
			!existing ||
			(target.active && !existing.active) ||
			(target.active === existing.active &&
				(target.lastUpdate ?? target.startedAt ?? 0) >
					(existing.lastUpdate ?? existing.startedAt ?? 0))
		) {
			deduped.set(identity, target);
		}
	}
	return [...deduped.values()].sort((a, b) => {
		// Most recently started subagent run first, so the latest activity
		// surfaces at the top of the list rather than the bottom.
		const runStart = (b.run.startedAt ?? -1) - (a.run.startedAt ?? -1);
		if (runStart) return runStart;
		const runIdentity = a.run.runId.localeCompare(b.run.runId);
		if (runIdentity) return runIdentity;
		const stepIndex = (a.stepIndex ?? -1) - (b.stepIndex ?? -1);
		return stepIndex || a.key.localeCompare(b.key);
	});
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function subagentRunIdFromTool(item: ToolItem): string | undefined {
	if (!/subagent|delegate|agent/i.test(item.name)) return undefined;
	const details = record(item.details);
	for (const key of ["runId", "asyncId", "id"] as const) {
		const value = details?.[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

export function reconcileSubagentSelection(
	previousKey: string | undefined,
	previousTargets: readonly SubagentTarget[],
	nextTargets: readonly SubagentTarget[],
): string | undefined {
	if (previousKey && nextTargets.some((target) => target.key === previousKey))
		return previousKey;
	const previous = previousTargets.find((target) => target.key === previousKey);
	if (
		previous?.run.control === "foreground" &&
		previous.sessionFile &&
		previous.stepIndex !== undefined
	) {
		const matches = nextTargets.filter(
			(target) =>
				target.active &&
				target.canSteer &&
				target.sessionFile === previous.sessionFile &&
				target.stepIndex === previous.stepIndex,
		);
		if (matches.length === 1) return matches[0]?.key;
	}
	return nextTargets[0]?.key;
}

export function subagentTargetIdentity(target: SubagentTarget): string {
	const sessionFile = target.sessionFile?.trim();
	return sessionFile
		? `session:${target.stepIndex ?? "run"}:${sessionFile}`
		: `key:${target.key}`;
}

export type OwnedSubagentTargets = ReadonlyMap<string, SubagentTarget[]>;

const NEAREST_RUN_WINDOW_MS = 30_000;

function matchByRunIdOrToolCallId(
	item: ToolItem,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const runId = subagentRunIdFromTool(item);
	if (runId) {
		const byRunId = targets.filter((target) => target.run.runId === runId);
		if (byRunId.length > 0) return byRunId;
	}
	if (item.toolCallId) {
		const direct = targets.filter(
			(target) => target.toolCallId === item.toolCallId,
		);
		if (direct.length > 0) return direct;
	}
	return [];
}

export function ownedSubagentTargetsForItems(
	items: readonly ToolItem[],
	targets: readonly SubagentTarget[],
): OwnedSubagentTargets {
	const owners = new Map<string, string>();
	const assigned = new Map<string, SubagentTarget[]>();
	const claimed = new Set<string>();
	const assign = (target: SubagentTarget, ownerId: string) => {
		const identity = subagentTargetIdentity(target);
		const existingOwner = owners.get(identity);
		if (existingOwner && existingOwner !== ownerId) {
			// The same logical target reappeared under a different tool call; the
			// newer target replaces the older one under its original owner instead
			// of duplicating rows.
			const ownedTargets = assigned.get(existingOwner);
			const targetIndex =
				ownedTargets?.findIndex(
					(candidate) => subagentTargetIdentity(candidate) === identity,
				) ?? -1;
			if (ownedTargets && targetIndex >= 0) ownedTargets[targetIndex] = target;
			return;
		}
		owners.set(identity, ownerId);
		const ownedTargets = assigned.get(ownerId) ?? [];
		if (
			!ownedTargets.some(
				(candidate) => subagentTargetIdentity(candidate) === identity,
			)
		) {
			ownedTargets.push(target);
		}
		assigned.set(ownerId, ownedTargets);
		claimed.add(identity);
	};

	// Pass 1 — explicit ownership by runId / toolCallId. These keys reliably
	// tie a run to the tool call that spawned it.
	for (const item of items) {
		for (const target of matchByRunIdOrToolCallId(item, targets)) {
			assign(target, item.id);
		}
	}

	// Pass 2 — nearest-match fallback for runs that older pi-subagents results
	// emitted without a runId. Assign each still-unclaimed run to the single
	// closest subagent tool call within a tight window, 1:1, so a later
	// parallel spawn no longer attaches its children to an earlier unrelated
	// subagent tool call. Runs that cannot be unambiguously owned stay hidden.
	const unclaimedByRun = new Map<string, SubagentTarget[]>();
	for (const target of targets) {
		if (claimed.has(subagentTargetIdentity(target))) continue;
		const group = unclaimedByRun.get(target.run.runId) ?? [];
		group.push(target);
		unclaimedByRun.set(target.run.runId, group);
	}
	const usedFallbackItems = new Set<string>();
	for (const group of unclaimedByRun.values()) {
		const runStartedAt = group[0]?.run.startedAt ?? group[0]?.startedAt;
		if (runStartedAt === undefined) continue;
		let bestItem: ToolItem | undefined;
		let bestGap = NEAREST_RUN_WINDOW_MS;
		for (const item of items) {
			if (!/subagent|delegate|agent/i.test(item.name)) continue;
			if ((assigned.get(item.id) ?? []).length > 0) continue;
			if (usedFallbackItems.has(item.id)) continue;
			const gap = Math.abs(runStartedAt - item.timestamp);
			if (gap < bestGap) {
				bestGap = gap;
				bestItem = item;
			}
		}
		if (!bestItem) continue;
		usedFallbackItems.add(bestItem.id);
		for (const target of group) assign(target, bestItem.id);
	}

	return assigned;
}

export function targetsForTool(
	item: ToolItem,
	targets: readonly SubagentTarget[],
): SubagentTarget[] {
	const matched = matchByRunIdOrToolCallId(item, targets);
	if (matched.length > 0) return matched;

	// Legacy timestamp fallback for older pi-subagents results that omitted
	// runId. Kept for direct callers/tests; the owner pass in
	// `ownedSubagentTargetsForItems` uses a global nearest-match instead, which
	// prevents a later run from attaching to an earlier unrelated tool call.
	if (!/subagent|delegate|agent/i.test(item.name)) return [];
	const candidates = new Map<string, SubagentTarget[]>();
	for (const target of targets) {
		const startedAt = target.run.startedAt ?? target.startedAt;
		if (
			startedAt === undefined ||
			Math.abs(startedAt - item.timestamp) > NEAREST_RUN_WINDOW_MS
		)
			continue;
		const group = candidates.get(target.run.runId) ?? [];
		group.push(target);
		candidates.set(target.run.runId, group);
	}
	return candidates.size === 1 ? ([...candidates.values()][0] ?? []) : [];
}
