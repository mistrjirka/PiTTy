/** Subagent transcript JSONL parsing and stream reconciliation | transcript-stream-events. */

import * as fs from "node:fs";
import type { AssistantItem, ConversationItem } from "../types.ts";
import { fileContentKey } from "./cache-key.ts";
import type { ParsedTranscriptRecord } from "./transcript-records.ts";
import {
	MAX_SUBAGENT_SESSION_LINES,
	objectRecord,
	PROFILED_STREAM_TAIL_BYTES,
} from "./transcript-records.ts";

export function parseJsonlTail(content: string): ParsedTranscriptRecord[] {
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	const records: ParsedTranscriptRecord[] = [];
	for (
		let index = Math.max(0, lines.length - MAX_SUBAGENT_SESSION_LINES);
		index < lines.length;
		index++
	) {
		const line = lines[index];
		if (line === undefined) continue;
		try {
			const record = objectRecord(JSON.parse(line));
			if (record) records.push({ record, index });
		} catch {
			// The writer may leave the final JSONL line incomplete briefly.
		}
	}
	return records;
}

export type ProfiledStreamKind =
	| "thinking"
	| "text"
	| "tool_start"
	| "tool_end";

export type ProfiledStreamEvent = {
	seq: number;
	kind: ProfiledStreamKind;
	/** Accumulation key: `<runId>::<blockId>` (blockId falls back to kind). */
	key: string;
	/** Event's own runId (may be empty when the producer omits it). */
	runId: string;
	/** 1-based assistant message sequence from pi-subagent >=0.5.5. */
	messageSeq?: number;
	/** Block id (falls back to kind); the stable part of stream item ids. */
	blockId: string;
	text: string;
	toolName: string;
	toolCallId?: string | undefined;
	/** 0 when the producer omits `ts`; callers resolve it deterministically. */
	ts: number;
};

export type ProfiledStreamCacheEntry = {
	key: string;
	events: ProfiledStreamEvent[];
};

export const profiledStreamCache = new Map<string, ProfiledStreamCacheEntry>();

export const MAX_PROFILED_STREAM_CACHE_ENTRIES = 64;

export function isUnknownRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalStreamText(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

export function parseProfiledStreamEvent(
	line: string,
): ProfiledStreamEvent | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isUnknownRecord(parsed) || parsed.v !== 1) return undefined;
	const kind = parsed.kind;
	if (
		kind !== "thinking" &&
		kind !== "text" &&
		kind !== "tool_start" &&
		kind !== "tool_end"
	)
		return undefined;
	const runId = optionalStreamText(parsed.runId) ?? "";
	const blockId = optionalStreamText(parsed.blockId) ?? kind;
	const seq =
		typeof parsed.seq === "number" &&
		Number.isInteger(parsed.seq) &&
		parsed.seq >= 0
			? parsed.seq
			: 0;
	const messageSeq =
		typeof parsed.messageSeq === "number" &&
		Number.isInteger(parsed.messageSeq) &&
		parsed.messageSeq > 0
			? parsed.messageSeq
			: undefined;
	// Never Date.now(): an undated event must resolve identically on every
	// read. Callers fill it from neighboring events / the run deterministically.
	const ts =
		typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : 0;
	return {
		seq,
		kind,
		key: `${runId}::${messageSeq ?? "legacy"}::${blockId}`,
		runId,
		...(messageSeq !== undefined ? { messageSeq } : {}),
		blockId,
		text: optionalStreamText(parsed.text) ?? "",
		toolName: optionalStreamText(parsed.toolName) ?? "tool",
		...(optionalStreamText(parsed.toolCallId)
			? { toolCallId: optionalStreamText(parsed.toolCallId) }
			: {}),
		ts,
	};
}

export function readProfiledStreamEvents(
	eventsPath: string | undefined,
): ProfiledStreamEvent[] {
	if (!eventsPath) return [];
	let stat: fs.Stats;
	try {
		stat = fs.statSync(eventsPath);
		if (!stat.isFile()) return [];
	} catch {
		return [];
	}
	let content: string;
	try {
		const fd = fs.openSync(eventsPath, "r");
		try {
			const length = Math.min(stat.size, PROFILED_STREAM_TAIL_BYTES);
			const buffer = Buffer.alloc(length);
			const bytes = fs.readSync(
				fd,
				buffer,
				0,
				length,
				Math.max(0, stat.size - length),
			);
			content = buffer.subarray(0, bytes).toString("utf8");
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return [];
	}
	const key = fileContentKey(stat, content);
	const cached = profiledStreamCache.get(eventsPath);
	if (cached && cached.key === key) return cached.events;
	const lines = content.split("\n");
	const events: ProfiledStreamEvent[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined || !line.trim()) continue;
		const event = parseProfiledStreamEvent(line);
		if (
			event &&
			(event.kind === "tool_start" || event.kind === "tool_end" || event.text)
		)
			events.push(event);
	}
	profiledStreamCache.delete(eventsPath);
	profiledStreamCache.set(eventsPath, { key, events });
	while (profiledStreamCache.size > MAX_PROFILED_STREAM_CACHE_ENTRIES) {
		const oldest = profiledStreamCache.keys().next().value;
		if (typeof oldest !== "string") break;
		profiledStreamCache.delete(oldest);
	}
	return events;
}

export type StreamTextGroup = {
	key: string;
	runId: string;
	blockId: string;
	messageSeq?: number;
	completeFromStart: boolean;
	/** Deterministic disambiguation when one key yields several groups. */
	occurrence: number;
	thinking: string;
	text: string;
	ts: number;
};

export function streamTextGroupId(
	runId: string,
	group: StreamTextGroup,
): string {
	const message = group.messageSeq !== undefined ? `-m${group.messageSeq}` : "";
	const base = `subagent-stream-${runId}${message}-${group.blockId}`;
	return group.occurrence > 0 ? `${base}-g${group.occurrence}` : base;
}

export function sortProfiledItems(items: ConversationItem[]): void {
	const stableOrder = new Map(items.map((item, index) => [item.id, index]));
	items.sort((left, right) => {
		if (left.timestamp !== right.timestamp)
			return left.timestamp - right.timestamp;
		return (stableOrder.get(left.id) ?? 0) - (stableOrder.get(right.id) ?? 0);
	});
}

export function foldInterruptedAssistantRetries(
	items: ConversationItem[],
): void {
	const assistantByEntryId = new Map<string, AssistantItem>();
	for (const item of items) {
		if (item.kind === "assistant" && item.sourceEntryId)
			assistantByEntryId.set(item.sourceEntryId, item);
	}
	const remove = new Set<string>();
	for (let index = 0; index < items.length; index++) {
		const retry = items[index];
		if (retry?.kind !== "assistant" || !retry.sourceParentId) continue;
		const interrupted = assistantByEntryId.get(retry.sourceParentId);
		if (!interrupted || interrupted.id === retry.id) continue;
		if (
			interrupted.stopReason !== "error" ||
			interrupted.errorMessage ||
			interrupted.text.trim() ||
			!interrupted.thinking.trim()
		)
			continue;
		if (
			interrupted.sourceMessageSeq !== undefined &&
			retry.sourceMessageSeq !== undefined &&
			retry.sourceMessageSeq !== interrupted.sourceMessageSeq + 1
		)
			continue;
		items[index] = {
			...retry,
			thinking: [interrupted.thinking, retry.thinking]
				.filter((value) => value.trim())
				.join("\n\n"),
			timestamp: Math.min(interrupted.timestamp, retry.timestamp),
			retriedAfterInterruptedThinking: true,
		};
		remove.add(interrupted.id);
	}
	if (remove.size === 0) return;
	for (let index = items.length - 1; index >= 0; index--) {
		if (remove.has(items[index]?.id ?? "")) items.splice(index, 1);
	}
}
