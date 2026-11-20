/** Subagent transcript JSONL parsing and stream reconciliation | transcript-reader-records. */

import * as fs from "node:fs";
import type { ConversationItem, SubagentRun, ToolItem } from "../types.ts";

import { fileContentKey } from "./cache-key.ts";
import { readSessionTail } from "./session-tail.ts";
import type { ParsedTranscriptRecord } from "./transcript-records.ts";

import {
	MAX_TRANSCRIPT_RECORD_CACHE_ENTRIES,
	normalized,
	objectRecord,
	subagentTranscriptPath,
	text,
	transcriptRecordCache,
} from "./transcript-records.ts";
import { parseJsonlTail } from "./transcript-stream-events.ts";

export function readSessionMessages(
	run: SubagentRun,
	stepIndex?: number,
): unknown[] {
	const selected =
		stepIndex === undefined
			? undefined
			: run.steps.find((step) => step.index === stepIndex)?.sessionFile;
	const sessionFile = selected ?? run.sessionFile;
	if (!sessionFile) return [];
	let content: string;
	try {
		content = readSessionTail(sessionFile, 24 * 1024 * 1024);
	} catch {
		return [];
	}
	const messages: unknown[] = [];
	for (const { record } of parseJsonlTail(content)) {
		// Pi stores a compaction as its own entry, not a message. Project it the
		// way Pi's get_messages does for the main chat (`compactionSummary`), so
		// both views share one decoder and one row.
		if (text(record.type) === "compaction") {
			messages.push({
				role: "compactionSummary",
				summary: text(record.summary),
				...(typeof record.tokensBefore === "number" ? { tokensBefore: record.tokensBefore } : {}),
				...(Number.isFinite(Date.parse(text(record.timestamp)))
					? { timestamp: Date.parse(text(record.timestamp)) }
					: {}),
			});
			continue;
		}
		const message = objectRecord(record.message);
		if (!message) continue;
		const entryId = text(record.id).trim();
		const parentId = text(record.parentId).trim();
		messages.push({
			...message,
			...(entryId ? { __pittyEntryId: entryId } : {}),
			...(parentId ? { __pittyParentId: parentId } : {}),
		});
	}
	return messages;
}

export function readRecords(
	run: SubagentRun,
	stepIndex?: number,
): ParsedTranscriptRecord[] {
	const transcriptPath = subagentTranscriptPath(run, stepIndex);
	if (!transcriptPath) return [];
	let stat: fs.Stats;
	try {
		stat = fs.statSync(transcriptPath);
	} catch {
		return [];
	}
	let content: string;
	try {
		content = fs.readFileSync(transcriptPath, "utf8");
	} catch {
		return [];
	}
	// Key on stat + content, not (mtimeMs, size): same-size rewrites inside
	// one mtime tick must not serve the previous parse.
	const key = fileContentKey(stat, content);
	const cached = transcriptRecordCache.get(transcriptPath);
	if (cached && cached.key === key) return cached.records;
	const records = parseJsonlTail(content);
	transcriptRecordCache.delete(transcriptPath);
	transcriptRecordCache.set(transcriptPath, {
		key,
		records,
	});
	while (transcriptRecordCache.size > MAX_TRANSCRIPT_RECORD_CACHE_ENTRIES) {
		const oldest = transcriptRecordCache.keys().next().value;
		if (typeof oldest !== "string") break;
		transcriptRecordCache.delete(oldest);
	}
	return records;
}

export function substantiveRecordTimestamp(
	record: Record<string, unknown>,
): number | undefined {
	const recordType = text(record.recordType);
	const role = text(record.role);
	if (
		recordType !== "tool_start" &&
		recordType !== "tool_end" &&
		role !== "tool" &&
		role !== "toolResult"
	) {
		return undefined;
	}
	return typeof record.ts === "number" ? record.ts : undefined;
}

export function subagentActivityAt(
	run: SubagentRun,
	stepIndex?: number,
): number | undefined {
	const step =
		stepIndex === undefined
			? undefined
			: run.steps.find((candidate) => candidate.index === stepIndex);
	const persisted = step
		? (step.lastActivityAt ??
			step.currentToolStartedAt ??
			step.endedAt ??
			run.endedAt)
		: stepIndex === undefined
			? (run.lastActivityAt ?? run.currentToolStartedAt ?? run.endedAt)
			: undefined;
	if (run.runtime === "profiled-subagents")
		return persisted ?? run.lastActivityAt;
	return persisted ?? substantiveSubagentActivityAt(run, stepIndex);
}

export function substantiveSubagentActivityAt(
	run: SubagentRun,
	stepIndex?: number,
): number | undefined {
	let latest: number | undefined;
	for (const { record } of readRecords(run, stepIndex)) {
		const timestamp = substantiveRecordTimestamp(record);
		if (timestamp !== undefined && (latest === undefined || timestamp > latest))
			latest = timestamp;
	}
	return latest;
}

export function findPendingTool(
	items: ConversationItem[],
	pending: Map<string, number[]>,
	key: string,
	predicate: (tool: ToolItem) => boolean,
): number | undefined {
	const queue = pending.get(key) ?? [];
	for (const index of queue) {
		const item = items[index];
		if (item?.kind === "tool" && predicate(item)) return index;
	}
	return undefined;
}

export function userRecordSubtype(record: Record<string, unknown>): string {
	return text(record.subtype) || text(record.messageType);
}

export function isKnownDuplicateUserRecord(
	previous:
		| { text: string; record: Record<string, unknown>; index: number }
		| undefined,
	current: { text: string; record: Record<string, unknown>; index: number },
): boolean {
	if (!previous || normalized(previous.text) !== normalized(current.text))
		return false;
	const previousId = text(previous.record.id);
	const currentId = text(current.record.id);
	if (previousId && currentId && previousId === currentId) return true;
	const previousSubtype = userRecordSubtype(previous.record);
	const currentSubtype = userRecordSubtype(current.record);
	return (
		previous.index + 1 === current.index &&
		((previousSubtype === "initial_prompt" &&
			currentSubtype === "message_end") ||
			(previousSubtype === "message_end" &&
				currentSubtype === "initial_prompt"))
	);
}
