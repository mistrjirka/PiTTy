import type { ForkMessage, SessionEntry } from "../types.ts";

/** Normalize only representation noise; message content remains otherwise exact. */
export type UserMessageText = {
	text: string;
};

export function normalizeEntryText(text: string): string {
	return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * Align visible user items with persisted user entries in order. A mismatch
 * fails closed rather than assigning an entry to the wrong message.
 */
export function alignUserEntryIds(
	userItems: readonly UserMessageText[],
	messages: readonly ForkMessage[],
): Array<string | undefined> {
	const result: Array<string | undefined> = [];
	let cursor = 0;
	for (const item of userItems) {
		const wanted = normalizeEntryText(item.text);
		while (cursor < messages.length && normalizeEntryText(messages[cursor]?.text ?? "") !== wanted) {
			cursor += 1;
		}
		const match = messages[cursor];
		if (!match) {
			result.push(undefined);
			continue;
		}
		result.push(match.entryId);
		cursor += 1;
	}
	return result;
}

export type ForkPickerOption = {
	entryId: string;
	label: string;
	index: number;
};

export function forkPickerOptions(messages: readonly ForkMessage[]): ForkPickerOption[] {
	return messages.map((message, index) => ({
		entryId: message.entryId,
		label: `${index + 1}. ${message.text.replace(/\s+/g, " ").slice(0, 80)}`,
		index,
	}));
}

export function userMessagesFromEntries(entries: readonly SessionEntry[]): ForkMessage[] {
	return entries.flatMap((entry) => {
		if (entry.type !== "message" && entry.type !== "custom_message") return [];
		const message = entry.message;
		if (!message || typeof message !== "object") return [];
		const record = message as Record<string, unknown>;
		if (record.role !== "user") return [];
		const content = record.content;
		const text = typeof content === "string"
			? content
			: Array.isArray(content)
				? content.filter((part): part is Record<string, unknown> => !!part && typeof part === "object")
					.flatMap((part) => typeof part.text === "string" ? [part.text] : [])
					.join("")
				: undefined;
		return typeof text === "string" ? [{ entryId: entry.id, text }] : [];
	});
}

export class EntryIndex {
	private messages: ForkMessage[] = [];
	private ids: Array<string | undefined> = [];
	private lastLeafId: string | null = null;

	refresh(messages: readonly ForkMessage[], userItems: readonly UserMessageText[]): void {
		this.messages = [...messages];
		this.ids = alignUserEntryIds(userItems, this.messages);
	}

	applyEntries(
		entries: readonly SessionEntry[],
		leafId: string | null,
		userItems: readonly UserMessageText[],
	): void {
		this.messages = [...this.messages, ...userMessagesFromEntries(entries)];
		this.lastLeafId = leafId;
		this.ids = alignUserEntryIds(userItems, this.messages);
	}

	idsFor(userItems: readonly UserMessageText[]): Array<string | undefined> {
		this.ids = alignUserEntryIds(userItems, this.messages);
		return [...this.ids];
	}

	idFor(itemIndex: number): string | undefined { return this.ids[itemIndex]; }
	getLeafId(): string | null { return this.lastLeafId; }
}
