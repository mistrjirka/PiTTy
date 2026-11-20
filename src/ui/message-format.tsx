/** Message display, tool detail UI, and stable formatting | message-format. */

import type { Accessor } from "solid-js";

import stripAnsi from "strip-ansi";
import { isSubagentFamilyToolName } from "../subagents/profiled.ts";
import type { ConversationItem, CustomItem, ToolItem } from "../types.ts";
import { formatDuration } from "./duration.ts";
import { colors } from "./theme.ts";

export function toolVisual(
	name: string,
	isError: boolean,
): { accent: string; background: string; icon: string } {
	if (isError)
		return { accent: colors.red, background: colors.toolOtherBg, icon: "×" };
	const normalized = name.toLowerCase();
	if (/write|edit|patch|replace/.test(normalized))
		return { accent: colors.green, background: colors.toolWriteBg, icon: "◆" };
	if (/bash|shell|exec|command|terminal/.test(normalized))
		return { accent: colors.orange, background: colors.toolShellBg, icon: "▣" };
	if (normalized === "subagent_supervisor")
		return { accent: colors.purple, background: colors.toolAgentBg, icon: "◇" };
	if (isSubagentFamilyToolName(name))
		return { accent: colors.purple, background: colors.toolAgentBg, icon: "◇" };
	if (/read|grep|find|search|list|glob|web|fetch/.test(normalized))
		return { accent: colors.accent, background: colors.toolReadBg, icon: "●" };
	return { accent: colors.cyan, background: colors.toolOtherBg, icon: "●" };
}

export function cleanTerminalText(value: string): string {
	return (
		stripAnsi(value)
			// A few transcript writers persist the CSI body after losing the ESC byte.
			// Remove only numeric ANSI color/cursor fragments, not ordinary bracketed text.
			.replace(/\[(?:\d{1,3};)+\d{0,3}[mGKHFJ]/g, "")
			.replace(/\[\d{1,3}[mGKHFJ]/g, "")
			.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
	);
}

export function clampDiffPath(value: string, maxLength = 48): string {
	if (value.length <= maxLength) return value;
	if (maxLength < 4) return value.slice(0, maxLength);
	const left = Math.ceil((maxLength - 1) / 2);
	const right = Math.floor((maxLength - 1) / 2);
	return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function diffLines(value: string): string[] {
	return cleanTerminalText(value).trimEnd().split(/\r?\n/);
}

export function diffStats(value: string): {
	additions: number;
	deletions: number;
} {
	let additions = 0;
	let deletions = 0;
	for (const line of diffLines(value)) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) additions += 1;
		else if (line.startsWith("-")) deletions += 1;
	}
	return { additions, deletions };
}

export function diffLineColor(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return colors.muted;
	if (line.startsWith("+")) return colors.green;
	if (line.startsWith("-")) return colors.red;
	if (line.startsWith("@@")) return colors.cyan;
	if (line.startsWith("diff ") || line.startsWith("Index:"))
		return colors.purple;
	return colors.text;
}

export function expandedDiffHeight(value: string): number {
	return Math.max(6, Math.min(22, diffLines(value).length));
}

export function prettyArgs(args: unknown): string {
	if (args === undefined) return "";
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}

/** Keys that carry the one value a reader needs to recognise a tool call. */
const TOOL_SUMMARY_KEYS = [
	"command",
	"cmd",
	"path",
	"file_path",
	"filePath",
	"url",
	"query",
	"glob",
] as const;

/**
 * One-line, human summary of a tool call's arguments for the quiet tool row
 * (`bash  bun run typecheck`, `grep  "timeoutMs" src/rpc`). Falls back to
 * compact JSON so unknown tools still show what they were called with.
 */
export function toolArgSummary(args: unknown, maxLength = 150): string {
	if (args === undefined || args === null) return "";
	const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
	const clipped = (value: string) =>
		value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
	if (typeof args === "string") return clipped(oneLine(args));
	const record = objectRecordValue(args);
	if (record) {
		const text = (key: string) =>
			typeof record[key] === "string" && record[key].trim()
				? oneLine(record[key])
				: undefined;
		const pattern = text("pattern");
		const target = TOOL_SUMMARY_KEYS.map(text).find(Boolean);
		if (pattern) return clipped(target ? `"${pattern}" ${target}` : `"${pattern}"`);
		if (target) return clipped(target);
	}
	const json = oneLine(prettyArgs(args));
	// An empty argument object says nothing; keep the row to the tool name.
	return json === "{}" || json === "[]" ? "" : clipped(json);
}

/** Status glyph shared by tool rows: running, failed, or finished. */
export function toolStatusGlyph(item: Pick<ToolItem, "status" | "isError">): {
	glyph: string;
	color: string;
} {
	if (item.isError || item.status === "error")
		return { glyph: "✗", color: colors.red };
	if (item.status === "streaming" || item.status === "pending")
		return { glyph: "◉", color: colors.accent };
	return { glyph: "✓", color: colors.green };
}

export function expandedToolHeight(output: string): number {
	// Layout is capped at 18 rows. Avoid allocating every line of a large log.
	let lines = 1;
	for (let i = 0; i < output.length && lines < 18; i++) {
		if (output.charCodeAt(i) === 10) lines++;
	}
	return Math.max(6, Math.min(18, lines + 1));
}

export function toolOutputExpandable(output: string): boolean {
	// Long outputs are already bigger than the collapsed preview.
	if (output.length > 512) return true;
	const clean = cleanTerminalText(output).trimEnd();
	if (!clean) return false;
	const lines = clean.split("\n");
	// The collapsed preview shows the whitespace-collapsed text on one line
	// (capped at 100 chars) and the expanded view caps at 18 rows, so offer the
	// toggle only when expanding reveals something the preview cannot:
	// - more lines than the expanded viewport can show (scrolling reveals rest)
	// - a single line longer than the preview cap (wrapping reveals the tail)
	// - multi-line output whose normalized content exceeds the preview cap
	if (lines.length > 18) return true;
	const normalized = clean.replace(/\s+/g, " ").trim();
	if (normalized.length > 120) return true;
	return lines.some((line) => line.length > 180);
}

export function collapsedPreview(output: string): string {
	// Inspect a bounded prefix. Full output is rendered only when expanded.
	const prefixLimit = 4096;
	const normalized = cleanTerminalText(output.slice(0, prefixLimit))
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) return output.length > prefixLimit ? "…" : "";
	return normalized.length > 100 || output.length > prefixLimit
		? normalized.slice(0, 97) + "…"
		: normalized;
}

export function cleanThinkingText(value: string): string {
	let result = cleanTerminalText(value).trimStart();
	// Some providers include their own “Thinking” heading. Strip every leading
	// copy so the UI heading is shown exactly once. Only strip an actual heading
	// (a colon or newline must follow), not normal prose such as “Thinking about…”.
	for (let index = 0; index < 4; index++) {
		const next = result
			.replace(
				/^\s*(?:[>|#*_`-]+\s*)*(?:thinking|reasoning)\s*(?::\s*|\r?\n\s*)/i,
				"",
			)
			.trimStart();
		if (next === result) break;
		result = next;
	}
	return result;
}

export function cleanAnswerText(value: string): string {
	return cleanTerminalText(value).trimStart();
}

export function thinkingLineCount(value: string): number {
	const clean = value.trim();
	return clean ? clean.split(/\r?\n/).length : 0;
}

/**
 * Thought heading: one muted line instead of a labelled panel. Clicking it
 * toggles the body, so the heading carries no separate expand/collapse word.
 */
export function thinkingHeading(
	streaming: boolean,
	expanded: boolean,
	lines: number,
): string {
	if (streaming) return `${expanded ? "▾" : "∴"} Thinking…`;
	return `${expanded ? "▾" : "∴"} Thought · ${lines} line${lines === 1 ? "" : "s"}`;
}

/** True when the next transcript item is a tool, so tool rows stack. */
export function nextItemIsTool(
	items: readonly ConversationItem[],
	itemId: string,
): boolean {
	const index = items.findIndex((candidate) => candidate.id === itemId);
	return index >= 0 && items[index + 1]?.kind === "tool";
}

export function collapsedThinkingPreview(
	value: string,
	maxChars: number,
): string {
	const clean = value.replace(/\s+/g, " ").trim();
	if (!clean) return "";
	const max = Math.max(24, Math.floor(maxChars));
	if (clean.length <= max) return clean;
	return `…${clean.slice(clean.length - (max - 1))}`;
}

export function supervisorArgs(
	args: unknown,
): Record<string, unknown> | undefined {
	return args && typeof args === "object" && !Array.isArray(args)
		? (args as Record<string, unknown>)
		: undefined;
}

export function supervisorToolLabel(args: unknown): string | undefined {
	const record = supervisorArgs(args);
	const action =
		typeof record?.action === "string" ? record.action.toLowerCase() : "";
	if (action === "reply") {
		const recipient =
			typeof record?.agent === "string" && record.agent.trim()
				? record.agent
				: typeof record?.replyTo === "string" && record.replyTo.trim()
					? record.replyTo
					: "";
		return `→ reply ${recipient}`.trim();
	}
	if (action === "status") return "supervisor status";
	if (action === "pending" || action === "list")
		return "pending supervisor requests";
	return undefined;
}

export function supervisorMessage(args: unknown): string {
	const message = supervisorArgs(args)?.message;
	return typeof message === "string" ? message : "";
}

export function customQuestionParts(item: CustomItem): {
	body: string;
	hint: string;
} {
	const lines = cleanTerminalText(item.text).split(/\r?\n/);
	let hintIndex = -1;
	for (let index = lines.length - 1; index >= 0; index--) {
		if (/^\s*Reply with:\s*subagent_supervisor\(/.test(lines[index] ?? "")) {
			hintIndex = index;
			break;
		}
	}
	if (
		hintIndex < 0 ||
		lines.slice(hintIndex + 1).some((line: string) => line.trim())
	)
		return { body: lines.join("\n"), hint: "" };
	return {
		body: lines.slice(0, hintIndex).join("\n").trimEnd(),
		hint: lines[hintIndex]!.trim(),
	};
}

export function objectRecordValue(
	value: unknown,
): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function customDetailsRecord(
	item: CustomItem,
): Record<string, unknown> | undefined {
	return objectRecordValue(item.details);
}

export function customDetail(item: CustomItem, key: string): string {
	const value = customDetailsRecord(item)?.[key];
	return typeof value === "string" && value.trim() ? value : "";
}

export function customDetailObject(
	item: CustomItem,
	key: string,
): Record<string, unknown> | undefined {
	const value = customDetailsRecord(item)?.[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function parsedNotification(item: CustomItem): Record<string, unknown> {
	let parsed: Record<string, unknown> = {};
	try {
		const value: unknown = JSON.parse(item.text);
		if (value && typeof value === "object" && !Array.isArray(value))
			parsed = value as Record<string, unknown>;
	} catch {
		// Details can still provide a valid notification when the text is not JSON.
	}
	return { ...parsed, ...customDetailsRecord(item) };
}

export function notificationText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

const SHOWN_LIMIT_MS = 10_000;
const SHOWN_DURATION_MS = 100;

export function toolTiming(item: ToolItem, now?: number): string {
	// Short limits are noise next to a short run; only a limit a reader might
	// actually wait for (over 10s) earns space on the row.
	const shown = (ms: number | undefined) => ms !== undefined && ms > SHOWN_LIMIT_MS;
	const timeout = shown(item.timeoutMs) ? `timeout ${formatDuration(item.timeoutMs!, "")}` : "";
	const wait = shown(item.waitMs) ? `wait up to ${formatDuration(item.waitMs!, "")}` : "";
	const limits = [timeout, wait].filter(Boolean).join(" · ");
	const startedAt = item.startedAt;
	if (startedAt === undefined) return limits;
	const end = item.endedAt ?? now;
	// No end and no clock: do not invent an epoch-based duration.
	if (end === undefined) return limits;
	const elapsed = Math.max(0, end - startedAt);
	// `0ms` reads as broken: sub-100ms calls are effectively instant, and a
	// replayed session often has equal start and end stamps.
	const duration = elapsed < SHOWN_DURATION_MS ? "" : formatDuration(elapsed, "");
	if (item.status === "streaming" || item.status === "pending") {
		if (!duration) return limits;
		return `${duration}${limits ? ` / ${limits}` : ""}`;
	}
	// The quiet tool row right-aligns this next to a ✓/✗ glyph, so a bare
	// duration reads as "took" without spending the word.
	return duration ? `${duration}${limits ? ` · ${limits}` : ""}` : limits;
}

export type MessageItemSource = ConversationItem | Accessor<ConversationItem>;

export function currentMessageItem(
	source: MessageItemSource,
): ConversationItem {
	return typeof source === "function" ? source() : source;
}

export function resolvedBoolean(
	value: boolean | Accessor<boolean> | undefined,
): boolean {
	return typeof value === "function" ? value() : value === true;
}
