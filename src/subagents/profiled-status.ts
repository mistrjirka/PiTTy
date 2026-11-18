/** Validated profiled agent status files and read-only filesystem boundaries. */
import * as fs from "node:fs";
import * as path from "node:path";
import type { SubagentActiveTool, ToolItem } from "../types.ts";
import {
	PROFILED_RUNTIME_ROOT_PREFIX,
	profiledScanBase,
	safeProfiledControlDir,
} from "./profiled-paths.ts";

export const RUNTIME = "profiled-subagents" as const;

export type ProfiledStatus = {
	version: 1;
	runtime: typeof RUNTIME;
	agentId: string;
	profile: string;
	treeId: string;
	parentAgentId: string;
	label: string;
	state: string;
	startedAt: number;
	updatedAt: number;
	sessionPath?: string;
	model?: string;
	thinking?: string;
	waitingForParent?: boolean;
	pendingQuestion?: string;
	pendingQuestionContext?: string;
	activeTools?: SubagentActiveTool[];
	turnCount?: number;
	toolCount?: number;
	windowTokens?: number;
	lastActivityAt?: number;
};

export function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function activeTools(value: unknown): SubagentActiveTool[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const tools = new Map<string, SubagentActiveTool>();
	for (const entry of value) {
		const item = record(entry);
		const toolCallId = text(item?.toolCallId);
		const toolName = text(item?.toolName);
		const startedAt = number(item?.startedAt);
		if (!toolCallId || !toolName || startedAt === undefined || startedAt <= 0)
			continue;
		const timeoutSeconds = number(item?.timeoutSeconds);
		tools.set(toolCallId, {
			toolCallId,
			toolName,
			startedAt,
			...(timeoutSeconds !== undefined &&
			timeoutSeconds > 0 &&
			Number.isFinite(timeoutSeconds * 1000)
				? { timeoutSeconds }
				: {}),
		});
	}
	return [...tools.values()];
}

export function toolState(
	item: ToolItem,
	details: Record<string, unknown>,
): string {
	if (item.status === "streaming" || item.status === "pending")
		return text(details.state) ?? "running";
	if (item.status === "error") return "failed";
	return "completed";
}

export function runtimeRoots(): string[] {
	// Scoped to profiledScanBase(): production scans os.tmpdir() as before,
	// while tests point PI_PITTY_PROFILED_ROOT at an isolated temp root so
	// the fallback scan below sees only that test's fixtures.
	const base = profiledScanBase();
	let names: string[];
	try {
		names = fs.readdirSync(base);
	} catch {
		return [];
	}
	return names
		.filter((name) => name.startsWith(PROFILED_RUNTIME_ROOT_PREFIX))
		.map((name) => path.join(base, name))
		.filter((candidate) => {
			try {
				const stat = fs.lstatSync(candidate);
				return stat.isDirectory() && !stat.isSymbolicLink();
			} catch {
				return false;
			}
		});
}

export function safeControlDir(candidate: string): string | undefined {
	return safeProfiledControlDir(candidate);
}

export function safeStatusPath(
	controlDir: string,
	candidate?: string,
): string | undefined {
	const base = safeControlDir(controlDir);
	if (!base) return undefined;
	const filePath = path.resolve(candidate ?? path.join(base, "status.json"));
	const relative = path.relative(base, filePath);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	)
		return undefined;
	try {
		const stat = fs.lstatSync(filePath);
		if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
	} catch {
		return undefined;
	}
	return filePath;
}

/**
 * Locate the live event stream exactly like the status file: a regular
 * non-symlink file that is a DIRECT child of the validated control dir.
 * Returns undefined when the file is absent (e.g. after a Pi restart the
 * whole control dir — and the stream with it — is gone).
 */
export function safeEventsPath(
	controlDir: string,
	candidate?: string,
): string | undefined {
	const base = safeControlDir(controlDir);
	if (!base) return undefined;
	const filePath = path.resolve(candidate ?? path.join(base, "events.jsonl"));
	const relative = path.relative(base, filePath);
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	)
		return undefined;
	if (relative.includes(path.sep)) return undefined;
	try {
		const stat = fs.lstatSync(filePath);
		if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
	} catch {
		return undefined;
	}
	return filePath;
}

export function parseStatus(
	controlDir: string,
	statusPath?: string,
): ProfiledStatus | undefined {
	const safe = safeStatusPath(controlDir, statusPath);
	if (!safe) return undefined;
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(safe, "utf8"));
	} catch {
		return undefined;
	}
	const value = record(raw);
	if (!value || value.version !== 1 || value.runtime !== RUNTIME)
		return undefined;
	const agentId = text(value.agentId);
	const profile = text(value.profile);
	const treeId = text(value.treeId);
	const parentAgentId = text(value.parentAgentId);
	const label = text(value.label);
	const state = text(value.state);
	const startedAt = number(value.startedAt);
	const updatedAt = number(value.updatedAt);
	const turnCount = number(value.turnCount);
	const toolCount = number(value.toolCount);
	const windowTokens = number(value.windowTokens);
	const lastActivityAt = number(value.lastActivityAt);
	if (
		!agentId ||
		!profile ||
		!treeId ||
		!parentAgentId ||
		!label ||
		!state ||
		startedAt === undefined ||
		updatedAt === undefined
	)
		return undefined;
	return {
		version: 1,
		runtime: RUNTIME,
		agentId,
		profile,
		treeId,
		parentAgentId,
		label,
		state,
		startedAt,
		updatedAt,
		...(text(value.sessionPath)
			? { sessionPath: text(value.sessionPath)! }
			: {}),
		...(text(value.model) ? { model: text(value.model)! } : {}),
		...(text(value.thinking) ? { thinking: text(value.thinking)! } : {}),
		...(value.waitingForParent === true ? { waitingForParent: true } : {}),
		...(value.waitingForParent === true && text(value.pendingQuestion)
			? { pendingQuestion: text(value.pendingQuestion)! }
			: {}),
		...(value.waitingForParent === true && text(value.pendingQuestionContext)
			? { pendingQuestionContext: text(value.pendingQuestionContext)! }
			: {}),
		...(Array.isArray(value.activeTools)
			? { activeTools: activeTools(value.activeTools)! }
			: {}),
		...(turnCount !== undefined &&
		Number.isSafeInteger(turnCount) &&
		turnCount >= 0
			? { turnCount }
			: {}),
		...(toolCount !== undefined &&
		Number.isSafeInteger(toolCount) &&
		toolCount >= 0
			? { toolCount }
			: {}),
		...(windowTokens !== undefined &&
		Number.isSafeInteger(windowTokens) &&
		windowTokens > 0
			? { windowTokens }
			: {}),
		...(lastActivityAt !== undefined && lastActivityAt > 0
			? { lastActivityAt }
			: {}),
	};
}
