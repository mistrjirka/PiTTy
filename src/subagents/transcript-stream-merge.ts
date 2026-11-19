/** Subagent transcript JSONL parsing and stream reconciliation | transcript-stream-merge. */

import {
	type SessionToolCall,
	sessionToolCalls,
} from "../state/conversation.ts";

import { normalizeResultDetails } from "../state/result-diff.ts";
import type {
	AssistantItem,
	ConversationItem,
	SubagentRun,
	ToolItem,
} from "../types.ts";
import { profiledRunIsLive } from "./profiled.ts";
import { readSessionMessages } from "./transcript-reader-records.ts";
import { objectRecord, text } from "./transcript-records.ts";
import type {
	ProfiledStreamEvent,
	StreamTextGroup,
} from "./transcript-stream-events.ts";
import {
	readProfiledStreamEvents,
	sortProfiledItems,
	streamTextGroupId,
} from "./transcript-stream-events.ts";

export function appendProfiledStreamItems(
	run: SubagentRun,
	items: ConversationItem[],
	stepIndex?: number,
): void {
	if (!run.eventsPath) return;
	const live = profiledRunIsLive(run);
	const events = readProfiledStreamEvents(run.eventsPath);
	if (events.length === 0) return;

	const headTruncated = (events[0]?.seq ?? 1) > 1;
	const first = events[0];
	const incompleteTaggedField =
		headTruncated &&
		first?.messageSeq !== undefined &&
		(first.kind === "thinking" || first.kind === "text")
			? `${first.messageSeq}:${first.kind}`
			: undefined;
	const taggedFieldGroups = new Map<
		number,
		{ thinking: number; text: number }
	>();
	let previousTextKey = "";
	for (const event of events) {
		if (event.kind !== "thinking" && event.kind !== "text") {
			previousTextKey = "";
			continue;
		}
		if (event.messageSeq === undefined) continue;
		const fieldKey = `${event.messageSeq}:${event.kind}`;
		if (fieldKey === incompleteTaggedField) continue;
		if (event.key === previousTextKey) continue;
		previousTextKey = event.key;
		const counts = taggedFieldGroups.get(event.messageSeq) ?? {
			thinking: 0,
			text: 0,
		};
		counts[event.kind] += 1;
		taggedFieldGroups.set(event.messageSeq, counts);
	}
	const taggedStream = events.some((event) => event.messageSeq !== undefined);
	const persistedAssistantBySeq = new Map<number, AssistantItem>();
	let latestPersistedAssistantAt = 0;
	let hasPersistedThinking = false;
	for (const item of items) {
		if (item.kind !== "assistant") continue;
		latestPersistedAssistantAt = Math.max(
			latestPersistedAssistantAt,
			item.timestamp,
		);
		hasPersistedThinking ||= Boolean(item.thinking);
		if (item.sourceMessageSeq !== undefined)
			persistedAssistantBySeq.set(item.sourceMessageSeq, item);
	}
	const useLegacyStreamThinking =
		!live && !taggedStream && !headTruncated && !hasPersistedThinking;

	// For tagged streams, exact message identity decides field ownership. The
	// stream owns fields it actually carries; the persisted session remains the
	// fallback for fields absent from or truncated out of the stream.
	if (taggedStream) {
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			if (item?.kind !== "assistant" || item.sourceMessageSeq === undefined)
				continue;
			const counts = taggedFieldGroups.get(item.sourceMessageSeq);
			if (!counts) continue;
			items[index] = {
				...item,
				thinking: counts.thinking > 0 ? "" : item.thinking,
				text: counts.text > 0 ? "" : item.text,
			};
		}
	}

	// Undated events resolve deterministically: previous event, else the run.
	let lastTs = 0;
	const eventTs = (event: ProfiledStreamEvent): number => {
		const ts = event.ts || lastTs || run.lastUpdate || run.startedAt || 0;
		lastTs = ts;
		return ts;
	};
	// Single pass in events.jsonl wire order: consecutive same-key
	// thinking/text chunks accumulate into one group; the group is flushed
	// inline at its wire position (on key change, on a tool event, or at the
	// end) so `think, tool, think, tool` renders interleaved instead of all
	// assistants first. Tool events are likewise handled inline at their wire
	// position, with args/output backfilled from the session file's
	// `toolCall`/`toolResult` entries for the same `toolCallId` (built lazily:
	// only when a stream tool actually needs it).
	let sessionTools: Map<string, SessionToolCall> | undefined;
	const getSessionTools = (): Map<string, SessionToolCall> =>
		(sessionTools ??= sessionToolCalls(readSessionMessages(run, stepIndex)));
	// Session-authoritative diff backfill for stream-built tools: the session's
	// `toolResult` messages carry `details` from which `initialItems` derives
	// the diff via `normalizeResultDetails`, but `sessionToolCalls` only joins
	// {name, args, output}. Without this map the stream item's Changes section
	// stays empty. No `createMutationDiff`: child-cwd files are unreadable
	// from here; the session is authoritative. Lazily built, like the join.
	let sessionDiffs:
		| Map<string, { diff: string; diffPath?: string; details: unknown }>
		| undefined;
	const getSessionDiffs = (): Map<
		string,
		{ diff: string; diffPath?: string; details: unknown }
	> => {
		if (sessionDiffs) return sessionDiffs;
		const map = new Map<
			string,
			{ diff: string; diffPath?: string; details: unknown }
		>();
		for (const message of readSessionMessages(run, stepIndex)) {
			const record = objectRecord(message);
			const role = typeof record?.role === "string" ? record.role : "";
			if (role !== "toolResult" && role !== "tool") continue;
			const toolCallId = text(record?.toolCallId).trim();
			if (!toolCallId) continue;
			const normalized = normalizeResultDetails(record?.details);
			if (!normalized.diff) continue;
			map.set(toolCallId, {
				diff: normalized.diff,
				...(normalized.path ? { diffPath: normalized.path } : {}),
				details: record?.details,
			});
		}
		sessionDiffs = map;
		return map;
	};
	const persistedToolCallIds = new Set<string>();
	for (const item of items) {
		if (item.kind === "tool") persistedToolCallIds.add(item.toolCallId);
	}
	const groupOccurrences = new Map<string, number>();
	const streamToolByCallId = new Map<string, number[]>();
	const streamToolByName = new Map<string, number[]>();
	const toolFallbackCounts = new Map<string, number>();
	const liveWireOrderById = new Map<string, number>();
	const liveToolStarts = new Map<
		string,
		{ timestamp: number; order: number }
	>();
	let liveWireOrder = 0;
	let current: StreamTextGroup | undefined;
	let eventIndex = -1;
	const flushCurrent = (): void => {
		const group = current;
		current = undefined;
		if (!group || (!group.thinking && !group.text)) return;
		const id = streamTextGroupId(group.runId || run.runId, group);
		const field = group.thinking ? "thinking" : "text";
		const persisted =
			group.messageSeq === undefined
				? undefined
				: persistedAssistantBySeq.get(group.messageSeq);
		if (!group.completeFromStart && persisted?.[field]) return;

		let streamThinking = group.thinking;
		let streamText = group.text;
		if (group.messageSeq !== undefined) {
			if (`${group.messageSeq}:${field}` === incompleteTaggedField) return;
			if (persisted) {
				const counts = taggedFieldGroups.get(group.messageSeq);
				const count = field === "thinking" ? counts?.thinking : counts?.text;
				const persistedValue = persisted[field];
				if (count === 1 && persistedValue) {
					const streamValue =
						field === "thinking" ? streamThinking : streamText;
					const authoritative =
						persistedValue.length >= streamValue.length
							? persistedValue
							: streamValue;
					if (field === "thinking") streamThinking = authoritative;
					else streamText = authoritative;
				}
			}
		} else {
			// Old profiled streams have no turn identity. Keep only stream content
			// that can be placed safely by chronology; completed answer text stays
			// session-authoritative, and historical plaintext thinking is used only
			// when the session has none at all.
			if (live && group.ts <= latestPersistedAssistantAt) return;
			if (!live && streamText) return;
			if (!live && streamThinking && !useLegacyStreamThinking) return;
		}

		const fresh: AssistantItem = {
			kind: "assistant",
			id,
			text: streamText,
			thinking: streamThinking,
			timestamp: group.ts,
			status: live && !persisted ? "streaming" : (persisted?.status ?? "done"),
			...(persisted?.stopReason ? { stopReason: persisted.stopReason } : {}),
			...(group.messageSeq !== undefined
				? { sourceMessageSeq: group.messageSeq }
				: {}),
			...(persisted?.sourceEntryId
				? { sourceEntryId: persisted.sourceEntryId }
				: {}),
			...(persisted?.sourceParentId
				? { sourceParentId: persisted.sourceParentId }
				: {}),
		};
		items.push(fresh);
		if (live) liveWireOrderById.set(id, liveWireOrder++);
	};
	for (const event of events) {
		eventIndex += 1;
		const ts = eventTs(event);
		if (event.kind === "thinking" || event.kind === "text") {
			if (!current || current.key !== event.key) {
				flushCurrent();
				const occurrence = groupOccurrences.get(event.key) ?? 0;
				groupOccurrences.set(event.key, occurrence + 1);
				current = {
					key: event.key,
					runId: event.runId,
					blockId: event.blockId,
					...(event.messageSeq !== undefined
						? { messageSeq: event.messageSeq }
						: {}),
					completeFromStart: !(headTruncated && eventIndex === 0),
					occurrence,
					thinking: "",
					text: "",
					ts,
				};
			}
			if (event.kind === "thinking") current.thinking += event.text;
			else current.text += event.text;
			continue;
		}
		flushCurrent();
		if (event.kind === "tool_start") {
			const wireOrder = live ? liveWireOrder++ : undefined;
			if (live && event.toolCallId !== undefined && wireOrder !== undefined) {
				liveToolStarts.set(event.toolCallId, {
					timestamp: ts,
					order: wireOrder,
				});
			}
			// A persisted session tool remains the rich row (output/diff/details),
			// but its live position comes from this tool_start event. Re-anchor it
			// after the stream fold instead of drawing a second stream row.
			if (
				event.toolCallId !== undefined &&
				persistedToolCallIds.has(event.toolCallId)
			)
				continue;
			const backfill =
				event.toolCallId !== undefined
					? getSessionTools().get(event.toolCallId)
					: undefined;
			const diffBackfill =
				event.toolCallId !== undefined
					? getSessionDiffs().get(event.toolCallId)
					: undefined;
			const fallbackKey = event.toolCallId ?? `name-${event.toolName}`;
			const fallbackCount = toolFallbackCounts.get(fallbackKey) ?? 0;
			toolFallbackCounts.set(fallbackKey, fallbackCount + 1);
			const suffix = fallbackCount > 0 ? `-n${fallbackCount}` : "";
			const callId =
				event.toolCallId ??
				`subagent-stream-${run.runId}-tool-${event.toolName}${suffix}-call`;
			const item: ToolItem = {
				kind: "tool",
				id: `subagent-stream-${run.runId}-tool-${event.toolCallId ?? `${event.toolName}${suffix}`}`,
				toolCallId: callId,
				name: event.toolName,
				args: backfill?.args,
				output: backfill?.output ?? "",
				...(diffBackfill ? { diff: diffBackfill.diff } : {}),
				...(diffBackfill?.diffPath ? { diffPath: diffBackfill.diffPath } : {}),
				...(diffBackfill ? { details: diffBackfill.details } : {}),
				timestamp: ts,
				startedAt: ts,
				status: live ? "streaming" : "done",
				isError: false,
			};
			items.push(item);
			if (live && wireOrder !== undefined)
				liveWireOrderById.set(item.id, wireOrder);
			const itemIndex = items.length - 1;
			const byName = streamToolByName.get(item.name) ?? [];
			byName.push(itemIndex);
			streamToolByName.set(item.name, byName);
			const byCall = streamToolByCallId.get(callId) ?? [];
			byCall.push(itemIndex);
			streamToolByCallId.set(callId, byCall);
			continue;
		}
		const queue =
			event.toolCallId !== undefined
				? streamToolByCallId.get(event.toolCallId)
				: streamToolByName.get(event.toolName);
		const targetIndex = queue?.find((index) => {
			const candidate = items[index];
			return candidate?.kind === "tool" && candidate.endedAt === undefined;
		});
		if (targetIndex === undefined) continue;
		const tool = items[targetIndex];
		if (tool?.kind === "tool") {
			const backfill = getSessionTools().get(tool.toolCallId);
			const diffBackfill = getSessionDiffs().get(tool.toolCallId);
			items[targetIndex] = {
				...tool,
				endedAt: ts,
				status: "done",
				output: tool.output || backfill?.output || "",
				...(diffBackfill && !tool.diff ? { diff: diffBackfill.diff } : {}),
				...(diffBackfill?.diffPath && !tool.diffPath
					? { diffPath: diffBackfill.diffPath }
					: {}),
				...(diffBackfill && tool.details === undefined
					? { details: diffBackfill.details }
					: {}),
			};
		}
	}
	flushCurrent();

	if (live) {
		// Session-backed tools carry the rich result payload, but their persisted
		// timestamp is the result-completion time. Move them to the tool_start
		// position from events.jsonl so thinking stays between the tools where it
		// actually happened.
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			if (item?.kind !== "tool") continue;
			const start = liveToolStarts.get(item.toolCallId);
			if (!start) continue;
			items[index] = {
				...item,
				timestamp: start.timestamp,
				startedAt: start.timestamp,
			};
			liveWireOrderById.set(item.id, start.order);
		}

		// Timestamps place session-only task/steer/custom rows around the live
		// stream; wire order breaks same-millisecond ties between stream-owned
		// thinking/text/tool rows.
		const stableOrder = new Map(items.map((item, index) => [item.id, index]));
		items.sort((left, right) => {
			if (left.timestamp !== right.timestamp)
				return left.timestamp - right.timestamp;
			const leftWire = liveWireOrderById.get(left.id);
			const rightWire = liveWireOrderById.get(right.id);
			if (leftWire !== undefined && rightWire !== undefined)
				return leftWire - rightWire;
			return (stableOrder.get(left.id) ?? 0) - (stableOrder.get(right.id) ?? 0);
		});
	} else if (taggedStream) {
		sortProfiledItems(items);
	}

	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (item?.kind === "assistant" && !item.text && !item.thinking)
			items.splice(index, 1);
	}
}
