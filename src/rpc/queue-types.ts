/** Fork RPC queue data. IDs identify messages, including repeated text. */
export type QueuedMessage = {
	id: string;
	mode: "steer" | "followUp";
	message: string;
};

export type QueueState = {
	revision: number;
	messages: QueuedMessage[];
};

export type QueueCommand =
	| { type: "get_queue" }
	| { type: "update_queued_message"; messageId: string; message: string; expectedRevision?: number }
	| { type: "remove_queued_message"; messageId: string; expectedRevision?: number }
	| { type: "combine_queued_messages"; messageIds: string[]; expectedRevision?: number };

/** Validate optional queue data at the RPC wire boundary. */
export function parseQueueState(value: unknown): QueueState | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0 || !Array.isArray(record.messages))
		return undefined;
	const messages: QueuedMessage[] = [];
	for (const entry of record.messages) {
		if (!entry || typeof entry !== "object") return undefined;
		const item = entry as Record<string, unknown>;
		if (typeof item.id !== "string" || !item.id || typeof item.message !== "string" ||
			(item.mode !== "steer" && item.mode !== "followUp")) return undefined;
		messages.push({ id: item.id, mode: item.mode, message: item.message });
	}
	return { revision: record.revision as number, messages };
}
