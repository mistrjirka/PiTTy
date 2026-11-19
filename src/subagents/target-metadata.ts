/** Subagent roster projection, foreground workflow and ownership | target-metadata. */

import * as fs from "node:fs";

import * as path from "node:path";

import type { SubagentRun, SubagentStep } from "../types.ts";

import { record } from "./target-identity.ts";

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

export type ChildArtifactMetadata = {
	model?: string;
	thinking?: string;
	contextWindow?: number;
	error?: string;
};

export function childArtifactMetadata(
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
		candidates.add(
			path.join(run.cwd, ".pi", "subagents", "artifacts", fileName),
		);
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

export function activeState(value: string | undefined): boolean {
	return (
		value === "pending" ||
		value === "running" ||
		value === "queued" ||
		value === "active" ||
		value === "working"
	);
}

export function targetLabel(
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

export type ForegroundEntry = {
	progress: Record<string, unknown>;
	result?: Record<string, unknown> | undefined;
	identity?: string | undefined;
	workflow?: boolean | undefined;
};

export function mergeLiveProgress(
	progress: Record<string, unknown>,
	live: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return live ? { ...progress, ...live } : progress;
}

export type RequestedMetadata = {
	label?: string;
	agent?: string;
	model?: string;
	thinking?: string;
	contextWindow?: number;
};

export function requestedChildren(args: unknown): RequestedMetadata[] {
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

export function meaningfulResult(result: Record<string, unknown>): boolean {
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

export function workflowIdentity(
	value: Record<string, unknown>,
): string | undefined {
	// Workflow keys are stable across the child lifecycle; runId is only added
	// to terminal trace entries and therefore must not replace the key.
	for (const key of ["workflowKey", "key", "childId", "runId", "id"] as const) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim())
			return candidate.trim();
	}
	return undefined;
}

export function workflowChildren(
	details: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
	const value = record(details.workflowChildren);
	if (value?.version !== 1 || !Array.isArray(value.children)) return new Map();
	const rows = new Map<string, Record<string, unknown>>();
	for (const child of value.children) {
		const row = record(child);
		const childId = typeof row?.childId === "string" ? row.childId.trim() : "";
		if (row && childId) {
			const activity = record(row.activity);
			rows.set(childId, activity ? { ...activity, ...row } : row);
		}
	}
	return rows;
}

export function workflowTrace(
	details: Record<string, unknown>,
): ForegroundEntry[] {
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

export function foregroundProgressState(
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
