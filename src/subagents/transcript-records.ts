/** Subagent transcript JSONL parsing and stream reconciliation | transcript-records. */

import { normalizeResultDetails } from "../state/result-diff.ts";
import type { SubagentRun, SubagentStep, ToolItem } from "../types.ts";
import { stableHash } from "./cache-key.ts";

export const MAX_SUBAGENT_SESSION_LINES = 700;

export const PROFILED_STREAM_TAIL_BYTES = 2 * 1024 * 1024;

export type ParsedTranscriptRecord = {
	record: Record<string, unknown>;
	index: number;
};

export type TranscriptRecordCacheEntry = {
	key: string;
	records: ParsedTranscriptRecord[];
};

export const transcriptRecordCache = new Map<
	string,
	TranscriptRecordCacheEntry
>();

export const MAX_TRANSCRIPT_RECORD_CACHE_ENTRIES = 128;

export function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function objectRecord(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function messageBlocks(
	message: unknown,
): Array<Record<string, unknown>> {
	const record = objectRecord(message);
	if (!record) return [];
	const content = record.content;
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content)
		? content.filter(
				(entry): entry is Record<string, unknown> =>
					Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
			)
		: [];
}

export function messageText(
	message: unknown,
	type: "text" | "thinking",
): string {
	return messageBlocks(message)
		.filter((block) =>
			type === "text"
				? block.type === "text"
				: block.type === "thinking" || block.type === "reasoning",
		)
		.map((block) =>
			type === "thinking"
				? text(block.thinking) || text(block.text)
				: text(block.text),
		)
		.filter(Boolean)
		.join("");
}

export function recordTimestamp(
	record: Record<string, unknown>,
	fallback = 0,
): number {
	// Never Date.now(): a missing `ts` must not mint a fresh timestamp per
	// poll. Callers thread the previous timestamp through as the fallback so
	// undated records sit with their neighbors deterministically.
	const ts = record.ts;
	return typeof ts === "number" && Number.isFinite(ts) ? ts : fallback;
}

export function stableRecordKey(record: Record<string, unknown>): string {
	const recordId = text(record.id);
	if (recordId) return `id-${recordId}`;
	const callId = text(record.toolCallId);
	if (callId)
		return `call-${text(record.recordType) || text(record.role) || "tool"}-${callId}`;
	return `blob-${stableHash(
		JSON.stringify({
			recordType: text(record.recordType),
			role: text(record.role),
			toolName: text(record.toolName),
			subtype: text(record.subtype) || text(record.messageType),
			ts:
				typeof record.ts === "number" && Number.isFinite(record.ts)
					? record.ts
					: 0,
			text: text(record.text),
			argsPreview: text(record.argsPreview),
			message: record.message ?? null,
			errorMessage: text(record.errorMessage),
			isError: Boolean(record.isError),
			details: record.details ?? null,
		}),
	)}`;
}

export function normalized(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

export function resultDiff(detailsValue: unknown): string | undefined {
	return normalizeResultDetails(detailsValue).diff;
}

export function resultPath(
	detailsValue: unknown,
	tool: ToolItem,
): string | undefined {
	const details = objectRecord(detailsValue);
	const direct = details?.path ?? details?.filePath ?? details?.file_path;
	if (typeof direct === "string" && direct.trim()) return direct.trim();
	if (
		/write|edit|patch|replace/i.test(tool.name) &&
		typeof tool.args === "string"
	) {
		const firstLine = tool.args.split(/\r?\n/, 1)[0]?.trim();
		if (firstLine && !firstLine.includes(" ")) return firstLine;
	}
	return undefined;
}

export function activeSubagentStep(run: SubagentRun): SubagentStep | undefined {
	const indexed =
		run.currentStep === undefined ? undefined : run.steps[run.currentStep];
	return (
		indexed ??
		run.steps.find((step) => step.status === "running") ??
		run.steps.at(-1)
	);
}

export function subagentTranscriptPath(
	run: SubagentRun,
	stepIndex?: number,
): string | undefined {
	const selected =
		stepIndex === undefined
			? undefined
			: run.steps.find((step) => step.index === stepIndex);
	const active =
		selected?.transcriptPath ??
		activeSubagentStep(run)?.transcriptPath ??
		run.transcriptPath;
	if (active) return active;
	for (let index = run.steps.length - 1; index >= 0; index--) {
		const transcriptPath = run.steps[index]?.transcriptPath;
		if (transcriptPath) return transcriptPath;
	}
	return undefined;
}
