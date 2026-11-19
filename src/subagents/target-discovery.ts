/** Subagent roster projection, foreground workflow and ownership | target-discovery. */

import type { SubagentRun, ToolItem } from "../types.ts";
import {
	isProfiledSubagentTool,
	type ProfiledSubagentOptions,
	profiledRunIsLive,
	profiledSubagentRunsFromTools,
} from "./profiled.ts";
import { foregroundTargets } from "./target-foreground.ts";
import {
	compareTargetRichness,
	record,
	subagentTargetIdentity,
} from "./target-identity.ts";

import type { RequestedMetadata, SubagentTarget } from "./target-metadata.ts";
import {
	activeState,
	childArtifactMetadata,
	requestedChildren,
	targetLabel,
} from "./target-metadata.ts";
import { subagentActivityAt } from "./transcript.ts";

export function subagentTargets(
	baseRuns: readonly SubagentRun[],
	tools: readonly ToolItem[] = [],
	options: ProfiledSubagentOptions = {},
): SubagentTarget[] {
	const runs = [...baseRuns, ...profiledSubagentRunsFromTools(tools, options)];
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
				step.transcriptPath ??
				child.transcriptPath ??
				childStep?.transcriptPath;
			if (
				!childStep &&
				sessionFile === step.sessionFile &&
				transcriptPath === step.transcriptPath
			)
				return step;
			const enrichedStep = childStep ? { ...childStep, ...step } : step;
			return { ...enrichedStep, sessionFile, transcriptPath };
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
			if (requested.length > 0)
				requestedByArtifactId.set(identifier, requested);
		}
	}
	for (const item of tools) {
		if (isProfiledSubagentTool(item)) continue;
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
					if (emptyWorkflowIds.has(identifier))
						fallbackWorkflowIds.add(identifier);
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
			.find(
				(metadata): metadata is RequestedMetadata[] => metadata !== undefined,
			);
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
				const active =
					activeState(step.activityState) || activeState(step.status);
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
					canSteer:
						run.control !== "mission" && active && Boolean(run.asyncDir),
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
					parentWorkflowRunId:
						step.parentWorkflowRunId ?? run.parentWorkflowRunId,
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

		const profiled = run.control === "profiled";
		const active = profiled
			? profiledRunIsLive(run)
			: activeState(run.activityState) || activeState(run.state);
		const profiledLabel = run.profile
			? run.label && run.label !== run.profile
				? `@${run.agentId ?? run.profile} · ${run.profile} — ${run.label}`
				: `@${run.agentId ?? run.profile} · ${run.profile}`
			: undefined;
		result.push({
			key: run.runId,
			run,
			label:
				profiledLabel ??
				targetLabel(
					run,
					undefined,
					requested?.length === 1 ? requested[0] : undefined,
				),
			state: run.state,
			active,
			canSteer: profiled
				? active && Boolean(run.controlDir)
				: active && Boolean(run.asyncDir),
			transcriptPath: run.transcriptPath,
			sessionFile: run.sessionFile,
			childRunId: run.runId,
			startedAt: run.startedAt,
			lastUpdate: subagentActivityAt(run) ?? run.lastUpdate,
			model:
				run.model ??
				(requested?.length === 1 ? requested[0]?.model : undefined),
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
		let match = candidates.sort(
			(a, b) => compareTargetRichness(b, a) || a.key.localeCompare(b.key),
		)[0];
		if (!match && trace.workflowKey !== undefined) {
			candidates = available(
				(target) =>
					target.workflowKey === trace.workflowKey &&
					target.parentWorkflowRunId === trace.parentWorkflowRunId,
			);
			match = candidates.sort(
				(a, b) => compareTargetRichness(b, a) || a.key.localeCompare(b.key),
			)[0];
		}
		if (!match) continue;
		matched.add(match);
		const mergedStep = match.step
			? {
					...match.step,
					status: trace.state,
					...(trace.run.model !== undefined ? { model: trace.run.model } : {}),
					...(trace.run.thinking !== undefined
						? { thinking: trace.run.thinking }
						: {}),
					...(trace.run.lastActivityAt !== undefined
						? { lastActivityAt: trace.run.lastActivityAt }
						: {}),
					...(trace.run.currentTool !== undefined
						? { currentTool: trace.run.currentTool }
						: {}),
					...(trace.run.currentToolStartedAt !== undefined
						? { currentToolStartedAt: trace.run.currentToolStartedAt }
						: {}),
					...(trace.run.turnCount !== undefined
						? { turnCount: trace.run.turnCount }
						: {}),
					...(trace.run.toolCount !== undefined
						? { toolCount: trace.run.toolCount }
						: {}),
				}
			: undefined;
		const merged: SubagentTarget = {
			...match,
			...(mergedStep ? { step: mergedStep } : {}),
			key: trace.key,
			state: trace.state,
			active: trace.active,
			canSteer: trace.canSteer,
			toolCallId: trace.toolCallId,
			lastUpdate: trace.lastUpdate ?? match.lastUpdate,
			model: trace.model ?? match.model,
			thinking: trace.thinking ?? match.thinking,
			childRunId: trace.childRunId ?? match.childRunId,
			run: {
				...match.run,
				state: trace.run.state,
				...(trace.run.lastUpdate !== undefined
					? { lastUpdate: trace.run.lastUpdate }
					: {}),
				...(trace.run.lastActivityAt !== undefined
					? { lastActivityAt: trace.run.lastActivityAt }
					: {}),
				...(trace.run.activityState !== undefined
					? { activityState: trace.run.activityState }
					: {}),
				...(trace.run.model !== undefined ? { model: trace.run.model } : {}),
				...(trace.run.thinking !== undefined
					? { thinking: trace.run.thinking }
					: {}),
				...(trace.run.currentTool !== undefined
					? { currentTool: trace.run.currentTool }
					: {}),
				...(trace.run.currentToolStartedAt !== undefined
					? { currentToolStartedAt: trace.run.currentToolStartedAt }
					: {}),
				...(trace.run.turnCount !== undefined
					? { turnCount: trace.run.turnCount }
					: {}),
				...(trace.run.toolCount !== undefined
					? { toolCount: trace.run.toolCount }
					: {}),
				...(trace.run.totalTokens !== undefined
					? { totalTokens: trace.run.totalTokens }
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
		if (!existing || compareTargetRichness(target, existing) > 0)
			deduped.set(identity, target);
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
