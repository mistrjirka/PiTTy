/** Subagent transcript JSONL parsing and stream reconciliation | transcript-legacy. */

import type { SubagentRun, SubagentTranscriptEntry } from "../types.ts";

import { readSubagentConversation } from "./transcript-reader.ts";

export function readSubagentTranscript(
	run: SubagentRun,
	maxEntries = 120,
): SubagentTranscriptEntry[] {
	const entries: SubagentTranscriptEntry[] = [];
	for (const item of readSubagentConversation(run, maxEntries)) {
		if (item.kind === "user") {
			entries.push({
				id: item.id,
				timestamp: item.timestamp,
				kind: "user",
				label: "task",
				text: item.text,
			});
		} else if (item.kind === "assistant") {
			if (item.thinking)
				entries.push({
					id: `${item.id}-thinking`,
					timestamp: item.timestamp,
					kind: "thinking",
					label: "thinking",
					text: item.thinking,
				});
			if (item.text)
				entries.push({
					id: `${item.id}-answer`,
					timestamp: item.timestamp,
					kind: "assistant",
					label: "assistant",
					text: item.text,
				});
		} else if (item.kind === "tool") {
			const args =
				typeof item.args === "string"
					? item.args
					: item.args === undefined
						? ""
						: JSON.stringify(item.args);
			entries.push({
				id: item.id,
				timestamp: item.timestamp,
				kind: "tool",
				label: item.name,
				text: item.output || args,
				isError: item.isError,
			});
		} else if (item.kind === "system") {
			entries.push({
				id: item.id,
				timestamp: item.timestamp,
				kind: "system",
				label: item.tone,
				text: item.text,
				isError: item.tone === "error",
			});
		}
	}
	return entries.slice(-maxEntries);
}
