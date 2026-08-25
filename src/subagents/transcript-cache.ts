import type { ConversationItem, SubagentRun } from "../types.ts";
import type { SubagentTarget } from "./targets.ts";
import { readSubagentConversation } from "./transcript.ts";

export type SubagentConversationReader = (
	run: SubagentRun,
	maxItems: number,
	stepIndex?: number,
) => ConversationItem[];

type TranscriptCacheEntry = {
	signature: string;
	items: ConversationItem[];
};

function valuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (typeof left !== typeof right || left === null || right === null) return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
		return left.every((value, index) => valuesEqual(value, right[index]));
	}
	if (typeof left !== "object" || typeof right !== "object") return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord);
	const rightKeys = Object.keys(rightRecord);
	return leftKeys.length === rightKeys.length && leftKeys.every(
		(key) => Object.hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key]),
	);
}

function reuseStableItems(items: ConversationItem[], previous: ConversationItem[] | undefined): ConversationItem[] {
	const previousById = new Map((previous ?? []).map((item) => [item.id, item]));
	return items.map((item) => {
		const oldItem = previousById.get(item.id);
		return oldItem && valuesEqual(oldItem, item) ? oldItem : item;
	});
}

function transcriptSignature(target: SubagentTarget): string {
	const step = target.step;
	const values = [
		target.key,
		target.run.runId,
		target.run.state,
		target.run.endedAt,
		target.stepIndex,
		target.sessionFile,
		target.transcriptPath,
		target.lastUpdate,
		step?.status,
		step?.activityState,
		step?.lastActivityAt,
		step?.currentToolStartedAt,
		step?.endedAt,
	];
	return values.map((value) => String(value ?? "")).join("\u001f");
}

/** Keep an unchanged selected transcript out of rerenders caused by sibling updates. */
export function createSubagentTranscriptCache(
	reader: SubagentConversationReader = readSubagentConversation,
): (target: SubagentTarget | undefined, inspect: boolean) => ConversationItem[] {
	let cached: TranscriptCacheEntry | undefined;
	return (target, inspect) => {
		if (!inspect || !target) return [];
		const signature = transcriptSignature(target);
		if (cached?.signature === signature) return cached.items;
		const items = reader(target.run, 160, target.stepIndex);
		const stableItems = reuseStableItems(items, cached?.items);
		cached = { signature, items: stableItems };
		return stableItems;
	};
}
