/** Reduce foreground tool progress and durable completions into the same conversation rows. */
import type { ConversationItem, ToolItem } from "../types.ts";
import { id, objectRecord, toolOutput, toolResultImages, toolTimeLimits } from "./conversation-shared.ts";
import { displayToolDetails } from "./conversation-history.ts";
import { createMutationDiff } from "./conversation-mutation.ts";
import { codeCellObservation, codeResultStatus, reconcileCodeCell, retainYieldedOutput } from "./code-tool-presentation.ts";
import { mergeNestedCallMetadata } from "./nested-tool-history.ts";
import { normalizeResultDetails } from "./result-diff.ts";

export function applyConversationToolEvent(
	items: ConversationItem[],
	toolIndices: Map<string, number>,
	event: Record<string, unknown>,
	cwd?: string,
): void {
	const toolCallId =
		typeof event.toolCallId === "string"
			? event.toolCallId
			: id("unknown-tool");
	let index = toolIndices.get(toolCallId) ?? -1;
	if (index >= 0) {
		const match = items[index];
		if (match?.kind !== "tool" || match.toolCallId !== toolCallId)
			index = -1;
	}
	let initialPreview: { diff?: string; path?: string } | undefined;
	if (index < 0) {
		const toolName =
			typeof event.toolName === "string" ? event.toolName : "tool";
		initialPreview = event.type === "tool_execution_start"
			? createMutationDiff(toolName, event.args, cwd)
			: {};
		const preview = initialPreview;
		const item: ToolItem = {
			kind: "tool",
			id: id("tool"),
			toolCallId,
			...(typeof event.parentToolCallId === "string" ? { parentToolCallId: event.parentToolCallId } : {}),
			name: toolName,
			args: event.args,
			output: "",
			...(preview.diff ? { diff: preview.diff } : {}),
			...(preview.path ? { diffPath: preview.path } : {}),
			timestamp: Date.now(),
			startedAt: Date.now(),
			...toolTimeLimits(toolName, event.args),
			status: "pending",
			isError: false,
		};
		items.push(item);
		index = items.length - 1;
		toolIndices.set(toolCallId, index);
	}

	const current = items[index] as ToolItem;
	if (event.type === "tool_execution_start") {
		const nextArgs = event.args ?? current.args;
		const preview = initialPreview ?? createMutationDiff(current.name, nextArgs, cwd);
		items[index] = {
			...current,
			args: nextArgs,
			...(preview.diff ? { diff: preview.diff } : {}),
			...(preview.path ? { diffPath: preview.path } : {}),
			startedAt: current.startedAt ?? Date.now(),
			...toolTimeLimits(current.name, nextArgs),
			status: "streaming",
		};
		return;
	}
	const result =
		event.type === "tool_execution_update"
			? event.partialResult
			: event.result;
	const normalizedResult = event.type === "tool_execution_end"
		? normalizeResultDetails(objectRecord(result)?.details)
		: {};
	const settledDiff = normalizedResult.diff;
	const details = objectRecord(result)?.details;
	const resultStatus = codeResultStatus(current.name, details);
	const isError = Boolean(event.isError) || resultStatus === "error";
	const observation = codeCellObservation(current.name, details);
	items[index] = {
		...current,
		output: toolOutput(result),
		images: toolResultImages(result),
		yieldedOutput: event.type === "tool_execution_end" && resultStatus === "running"
			? current.yieldedOutput ?? (current.status === "streaming" && current.output ? retainYieldedOutput(current.output) : undefined)
			: undefined,
		...(objectRecord(result)?.details !== undefined
			? { details: displayToolDetails(current.name, objectRecord(result)?.details) }
			: {}),
		...(settledDiff ? { diff: settledDiff } : {}),
		...(normalizedResult.path ? { diffPath: normalizedResult.path } : {}),
		status:
			event.type === "tool_execution_end"
				? isError
					? "error"
					: "done"
				: "streaming",
		...(event.type === "tool_execution_end" ? { endedAt: Date.now() } : {}),
		isError,
	};
	if (observation) reconcileCodeCell(items, observation);
	if (event.type === "tool_execution_end")
		mergeNestedCallMetadata(items, toolIndices, result, toolCallId, Date.now());
}
