import { objectRecord } from "./conversation-shared.ts";

export type ToolCompletion = {
	toolCallId: string;
	toolName: string;
	result: Record<string, unknown>;
};

/** Durable completion of a yielded call, delivered before agent_settled. */
export function toolCompletionFromEvent(value: unknown): ToolCompletion | undefined {
	const event = objectRecord(value);
	return event?.type === "entry_appended" ? toolCompletionFromEntry(event.entry) : undefined;
}

export function toolCompletionFromEntry(value: unknown): ToolCompletion | undefined {
	const entry = objectRecord(value);
	const result = objectRecord(entry?.result);
	if (entry?.type !== "tool_completion" || typeof entry.toolCallId !== "string" ||
		!entry.toolCallId || typeof entry.toolName !== "string" || !entry.toolName || !result) return undefined;
	if (entry.toolName.toLowerCase() === "code" && objectRecord(result.details)?.historical === true) return undefined;
	return { toolCallId: entry.toolCallId, toolName: entry.toolName, result };
}
