/** Subagent transcript JSONL parsing and stream reconciliation | transcript-reader. */

import { initialItems } from "../state/conversation.ts";

import { normalizeResultDetails } from "../state/result-diff.ts";

import type { ConversationItem, SubagentRun, ToolItem } from "../types.ts";

import {
	findPendingTool,
	isKnownDuplicateUserRecord,
	readRecords,
	readSessionMessages,
} from "./transcript-reader-records.ts";
import {
	messageText,
	objectRecord,
	recordTimestamp,
	resultDiff,
	resultPath,
	stableRecordKey,
	text,
} from "./transcript-records.ts";

import { foldInterruptedAssistantRetries } from "./transcript-stream-events.ts";
import { appendProfiledStreamItems } from "./transcript-stream-merge.ts";

export function readSubagentConversation(
	run: SubagentRun,
	maxItems = 160,
	stepIndex?: number,
): ConversationItem[] {
	const items: ConversationItem[] = [];
	const artifactRecords = readRecords(run, stepIndex);
	if (artifactRecords.length === 0) {
		const sessionItems = initialItems(readSessionMessages(run, stepIndex), {
			stableIds: true,
		});
		if (sessionItems.length > 0) {
			const tail = sessionItems.slice(-maxItems);
			appendProfiledStreamItems(run, tail, stepIndex);
			foldInterruptedAssistantRetries(tail);
			return tail.slice(-maxItems);
		}
	}
	const pendingByName = new Map<string, number[]>();
	const pendingByCallId = new Map<string, number[]>();
	const resolvedTools = new Set<number>();
	const keyOccurrences = new Map<string, number>();
	let previousUser:
		| { text: string; record: Record<string, unknown>; index: number }
		| undefined;
	let lastTimestamp = 0;

	for (const { record, index } of artifactRecords) {
		const timestamp = recordTimestamp(record, lastTimestamp);
		lastTimestamp = timestamp;
		// Content-stable identity: the same record keeps the same id across
		// reads, and appending a line leaves earlier records' ids unchanged.
		// Duplicated content gets a deterministic occurrence suffix.
		const key = stableRecordKey(record);
		const occurrence = keyOccurrences.get(key) ?? 0;
		keyOccurrences.set(key, occurrence + 1);
		const base = `subagent-${text(record.runId) || run.runId}-${key}${occurrence > 0 ? `-dup${occurrence}` : ""}`;
		const recordType = text(record.recordType);
		const role = text(record.role);

		if (recordType === "tool_start") {
			const name = text(record.toolName) || "tool";
			const callId = text(record.toolCallId);
			const item: ToolItem = {
				kind: "tool",
				id: `${base}-tool`,
				toolCallId: callId || `${base}-call`,
				name,
				args: text(record.argsPreview) || undefined,
				output: "",
				timestamp,
				startedAt: timestamp,
				status: "streaming",
				isError: false,
			};
			items.push(item);
			const itemIndex = items.length - 1;
			const queue = pendingByName.get(name) ?? [];
			queue.push(itemIndex);
			pendingByName.set(name, queue);
			if (callId) {
				const callQueue = pendingByCallId.get(callId) ?? [];
				callQueue.push(itemIndex);
				pendingByCallId.set(callId, callQueue);
			}
			continue;
		}

		if (recordType === "tool_end") {
			const name = text(record.toolName) || "tool";
			const callId = text(record.toolCallId);
			const targetIndex = callId
				? findPendingTool(
						items,
						pendingByCallId,
						callId,
						(tool) => tool.endedAt === undefined,
					)
				: findPendingTool(
						items,
						pendingByName,
						name,
						(tool) => tool.endedAt === undefined,
					);
			if (targetIndex !== undefined) {
				const tool = items[targetIndex] as ToolItem;
				items[targetIndex] = { ...tool, endedAt: timestamp, status: "pending" };
			}
			continue;
		}

		if (recordType === "stderr") {
			const value = text(record.text)
				.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
				.trim();
			if (value) {
				items.push({
					kind: "system",
					id: `${base}-stderr`,
					text: value,
					timestamp,
					tone: "error",
				});
			}
			continue;
		}

		if (recordType !== "message") continue;

		const rawMessage = objectRecord(record.message);
		const direct = text(record.text);

		if (role === "assistant") {
			const thinking = messageText(rawMessage, "thinking");
			const assistant = direct || messageText(rawMessage, "text");
			const stopReason = text(rawMessage?.stopReason);
			const errorMessage =
				text(rawMessage?.errorMessage) || text(record.errorMessage);
			if (!thinking && !assistant) {
				if (stopReason === "error" || errorMessage) {
					items.push({
						kind: "system",
						id: `${base}-error`,
						text: errorMessage || "Subagent assistant failed.",
						timestamp,
						tone: "error",
					});
				}
				continue;
			}
			items.push({
				kind: "assistant",
				id: `${base}-assistant`,
				text: assistant,
				thinking,
				timestamp,
				status: stopReason === "error" ? "error" : "done",
				...(stopReason ? { stopReason } : {}),
			});
			continue;
		}

		if (role === "toolResult" || role === "tool") {
			const output = direct || messageText(rawMessage, "text");
			const name =
				text(rawMessage?.toolName) || text(record.toolName) || "tool";
			const toolCallId =
				text(rawMessage?.toolCallId) || text(record.toolCallId);
			const displayToolCallId = toolCallId || `${base}-call`;
			const isError = Boolean(rawMessage?.isError ?? record.isError);
			const details = rawMessage?.details ?? record.details;
			const matchedIndex = toolCallId
				? findPendingTool(
						items,
						pendingByCallId,
						toolCallId,
						(tool) => !resolvedTools.has(items.indexOf(tool)),
					)
				: pendingByName.get(name)?.find((index) => !resolvedTools.has(index));
			if (matchedIndex === undefined) {
				const fallback: ToolItem = {
					kind: "tool",
					id: `${base}-tool-result`,
					toolCallId: displayToolCallId,
					name,
					args: undefined,
					output,
					details,
					diff: resultDiff(details),
					timestamp,
					startedAt: timestamp,
					endedAt: timestamp,
					status: isError ? "error" : "done",
					isError,
				};
				fallback.diffPath =
					normalizeResultDetails(details).path ?? resultPath(details, fallback);
				items.push(fallback);
			} else {
				const tool = items[matchedIndex] as ToolItem;
				items[matchedIndex] = {
					...tool,
					toolCallId: displayToolCallId,
					output,
					details,
					diff: resultDiff(details),
					diffPath:
						normalizeResultDetails(details).path ?? resultPath(details, tool),
					endedAt: tool.endedAt ?? timestamp,
					status: isError ? "error" : "done",
					isError,
				};
				resolvedTools.add(matchedIndex);
			}
			continue;
		}

		if (role === "user") {
			const userText = direct || messageText(rawMessage, "text");
			if (!userText) continue;
			if (userText === "[prompt redacted]; live Prompt Audit only.") continue;
			const currentUser = { text: userText, record, index };
			// pi-subagents commonly writes the same task once as initial_prompt and
			// again as message_end. Suppress only that known duplicate pair (or an
			// exact repeated record id), never an unrelated repeated prompt.
			if (isKnownDuplicateUserRecord(previousUser, currentUser)) continue;
			previousUser = currentUser;
			items.push({
				kind: "user",
				id: `${base}-user`,
				text: userText.slice(0, 4_000),
				timestamp,
				optimistic: false,
			});
		}
	}

	appendProfiledStreamItems(run, items, stepIndex);
	return items.slice(-maxItems);
}
