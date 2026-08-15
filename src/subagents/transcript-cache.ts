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
		cached = { signature, items };
		return items;
	};
}
