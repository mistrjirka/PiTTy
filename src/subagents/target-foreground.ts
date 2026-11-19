/** Subagent roster projection, foreground workflow and ownership | target-foreground. */

import type { SubagentRun, ToolItem } from "../types.ts";

import { childRunIdFromSessionFile } from "./artifacts.ts";

import { isSubagentFamilyToolName } from "./profiled.ts";
import { record } from "./target-identity.ts";

import type { ForegroundEntry, SubagentTarget } from "./target-metadata.ts";
import {
	activeState,
	foregroundProgressState,
	meaningfulResult,
	mergeLiveProgress,
	requestedChildren,
	workflowChildren,
	workflowIdentity,
	workflowTrace,
} from "./target-metadata.ts";

export function foregroundEntries(item: ToolItem): readonly ForegroundEntry[] {
	const details = record(item.details);
	const traceEntries = details ? workflowTrace(details) : [];
	const liveChildren = details
		? workflowChildren(details)
		: new Map<string, Record<string, unknown>>();
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
				const live = identity ? liveChildren.get(identity) : undefined;
				return live
					? {
							...entry,
							progress: mergeLiveProgress(entry.progress, live),
							identity,
						}
					: identity
						? { ...entry, identity }
						: entry;
			});
		if (entries.length > 0) {
			if (traceEntries.length === 0) {
				return entries.map((entry) => {
					const identity =
						entry.identity ?? workflowIdentity(entry.result ?? {});
					const live = identity ? liveChildren.get(identity) : undefined;
					return live
						? {
								...entry,
								progress: mergeLiveProgress(entry.progress, live),
								identity,
							}
						: entry;
				});
			}
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
					progress: {
						...mergeLiveProgress(
							{ ...trace.progress, ...terminal.progress },
							identity ? liveChildren.get(identity) : undefined,
						),
					},
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
	if (traceEntries.length > 0) {
		return traceEntries.map((entry) => {
			const live = entry.identity
				? liveChildren.get(entry.identity)
				: undefined;
			return live
				? { ...entry, progress: mergeLiveProgress(entry.progress, live) }
				: entry;
		});
	}
	const directProgress = details?.progress;
	if (!Array.isArray(directProgress)) return [];
	return directProgress.flatMap((value): ForegroundEntry[] => {
		const progress = record(value);
		return progress && Object.keys(progress).length > 0 ? [{ progress }] : [];
	});
}

export function foregroundTargets(item: ToolItem): SubagentTarget[] {
	if (!isSubagentFamilyToolName(item.name)) return [];
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
			workflow && typeof details?.runId === "string"
				? details.runId
				: undefined;
		const childRunId =
			workflow && typeof progress.runId === "string"
				? progress.runId
				: undefined;
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
			agent: typeof progress.agent === "string" ? progress.agent : label,
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
				typeof progress.currentTool === "string"
					? progress.currentTool
					: undefined,
			currentToolStartedAt:
				typeof progress.currentToolStartedAt === "number"
					? progress.currentToolStartedAt
					: undefined,
			activityState:
				typeof progress.activityState === "string"
					? progress.activityState
					: state,
			currentPath:
				typeof progress.currentPath === "string"
					? progress.currentPath
					: undefined,
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
