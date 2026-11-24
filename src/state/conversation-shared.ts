/** Shared typed message-field helpers used by history and live event reducers. */
import { stableHash } from "../subagents/cache-key.ts";
import type { CustomItem } from "../types.ts";

export function id(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function contentBlocks(
	message: unknown,
): Array<Record<string, unknown>> {
	if (!message || typeof message !== "object") return [];
	const content = (message as Record<string, unknown>).content;
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [];
	return content.filter(
		(entry): entry is Record<string, unknown> =>
			Boolean(entry) && typeof entry === "object",
	);
}

export function extractText(message: unknown): string {
	return contentBlocks(message)
		.filter((block) => block.type === "text")
		.map((block) => (typeof block.text === "string" ? block.text : ""))
		.join("");
}

/** Error-only assistant responses are visible even when no tokens were emitted. */
export function assistantErrorMessage(message: unknown): string | undefined {
	const record = objectRecord(message);
	if (record?.stopReason !== "error") return undefined;
	return stringField(record, "errorMessage")?.trim() || "Provider returned an error without details.";
}

export function extractThinking(message: unknown): string {
	return contentBlocks(message)
		.filter((block) => block.type === "thinking" || block.type === "reasoning")
		.map((block) => {
			if (typeof block.thinking === "string") return block.thinking;
			if (typeof block.text === "string") return block.text;
			return "";
		})
		.join("\n\n");
}

export function messageRole(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const role = (message as Record<string, unknown>).role;
	return typeof role === "string" ? role : undefined;
}

export function messageTimestamp(message: unknown, stable = false): number {
	if (!message || typeof message !== "object") return stable ? 0 : Date.now();
	const timestamp = (message as Record<string, unknown>).timestamp;
	if (typeof timestamp === "number") return timestamp;
	// Stable mode (child-transcript reads) must not mint a fresh Date.now()
	// per poll: it would defeat both item identity and the deep-compare cache.
	return stable ? 0 : Date.now();
}

export function normalizedText(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

export function customItemFromMessage(
	message: unknown,
	prefix: string,
	makeId: (prefix: string, key?: string) => string = id,
	stable = false,
): CustomItem | undefined {
	const record = objectRecord(message);
	if (!record || record.display === false) return undefined;
	const customType =
		typeof record.customType === "string" && record.customType.trim()
			? record.customType
			: typeof record.type === "string" && record.type.trim()
				? record.type
				: "custom";
	const text = extractText(message);
	return {
		kind: "custom",
		id:
			typeof record.id === "string" && record.id.trim()
				? record.id
				: makeId(
						prefix,
						stable ? stableHash(`${customType}\u0000${text}`) : undefined,
					),
		customType,
		text,
		...(record.details !== undefined ? { details: record.details } : {}),
		timestamp: messageTimestamp(message, stable),
	};
}

/** Image blocks are binary attachments, never text to display in a transcript. */
export type ToolResultImage = {
	mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
	/** Base64 payload is retained for the image renderable, not appended to output. */
	data: string;
};

const MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024;
const MAX_DISPLAY_IMAGES = 4;
function isImageMimeType(value: unknown): value is ToolResultImage["mimeType"] {
	return value === "image/jpeg" || value === "image/png" ||
		value === "image/webp" || value === "image/gif";
}

/** Retain bounded image attachments separately from text in live and restored tools. */
export function toolResultImages(result: unknown): ToolResultImage[] {
	const content = objectRecord(result)?.content;
	if (!Array.isArray(content)) return [];
	const images: ToolResultImage[] = [];
	for (const part of content) {
		if (images.length >= MAX_DISPLAY_IMAGES) break;
		const block = objectRecord(part);
		if (block?.type !== "image") continue;
		const { mimeType, data } = block;
		if (!isImageMimeType(mimeType) || typeof data !== "string" || data.length < 4 ||
			data.length > MAX_IMAGE_BASE64_CHARS || data.length % 4 !== 0 ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) continue;
		images.push({ mimeType, data });
	}
	return images;
}

export function toolOutput(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as Record<string, unknown>).content;
	if (!Array.isArray(content))
		return typeof content === "string" ? content : "";
	return content
		.filter((part): part is Record<string, unknown> =>
			Boolean(part) && typeof part === "object" && !Array.isArray(part))
		.map((part) =>
			part.type === "image" ? "" :
			typeof part.text === "string" ? part.text :
			typeof part.data === "string" ? part.data : "")
		.filter(Boolean)
		.join("\n");
}

export function objectRecord(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Guarded field readers for the event boundary: a malformed payload must
 * fall back to the default, never flow a wrong-typed value into state. */
export function stringField(
	record: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

export function numberField(
	record: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function stringArrayField(value: unknown): string[] {
	return Array.isArray(value) &&
		value.every((entry): entry is string => typeof entry === "string")
		? [...value]
		: [];
}

export function eventDelta(event: Record<string, unknown>): {
	text: string;
	thinking: string;
} {
	const raw = event.assistantMessageEvent;
	if (!raw || typeof raw !== "object") return { text: "", thinking: "" };
	const assistantEvent = raw as Record<string, unknown>;
	const type =
		typeof assistantEvent.type === "string" ? assistantEvent.type : "";
	const delta =
		typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
	if (!delta) return { text: "", thinking: "" };
	if (type === "text_delta") return { text: delta, thinking: "" };
	// Exact protocol types only: substring matching routed unrelated future
	// event types containing "thinking"/"reasoning" into the thought stream.
	if (type === "thinking_delta" || type === "reasoning_delta") {
		return { text: "", thinking: delta };
	}
	return { text: "", thinking: "" };
}

export function mergeStreamingText(
	existing: string,
	full: string,
	delta: string,
): string {
	// Provider snapshots occasionally lag behind the already-rendered deltas. Never
	// replace a longer live value with a shorter snapshot: shrinking streaming text
	// leaves stale terminal cells and visually cuts thoughts off.
	if (full) {
		if (!existing) return full;
		if (full.startsWith(existing)) return full;
		if (existing.startsWith(full)) return existing;
		if (full.length > existing.length) return full;
	}
	// The delta protocol carries no sequence/offset, so there is nothing to
	// dedupe against: every delta is appended unconditionally. (The old
	// `endsWith` check silently dropped a legitimate repeated delta, e.g.
	// streaming a repeated token or "\u2026".) Snapshot overlap is handled by
	// the `full` branch above, and the delta-only path below never dedupes.
	if (delta) return existing + delta;
	return existing;
}

function durationValue(value: unknown, multiplier: number, allowZero = false): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
		(!allowZero && value === 0)) return undefined;
	const milliseconds = value * multiplier;
	return Number.isFinite(milliseconds) ? Math.floor(milliseconds) : undefined;
}

/** Display budgets from known tool schemas. Never infer units from magnitude. */
export function toolTimeLimits(toolName: string, args: unknown): {
	timeoutMs?: number | undefined;
	waitMs?: number | undefined;
} {
	const record = objectRecord(args);
	if (!record) return {};
	if (toolName === "agent_wait") {
		// pi-subagent's timeout only ends the wait; it never stops the child.
		return { waitMs: durationValue(record.timeout_seconds, 1000, true) };
	}
	return {
		// Pi bash and pi-bg-bash define timeout in seconds. Other tools must
		// supply a unit-bearing field; a bare timeout has no universal unit.
		timeoutMs: toolName === "bash"
			? durationValue(record.timeout, 1000)
			: durationValue(record.timeoutMs ?? record.timeout_ms, 1),
		// A polling/yield window does not limit the underlying process.
		waitMs: durationValue(record.wait_seconds, 1000, true)
			?? durationValue(record.yield_time_ms, 1, true),
	};
}
