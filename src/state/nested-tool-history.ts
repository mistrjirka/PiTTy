/** Bounded saved nested-call evidence. Host output is not part of this record. */
import type { ConversationItem, ToolItem } from "../types.ts";
import { id, objectRecord } from "./conversation-shared.ts";

const MAX_CALLS = 256;
const MAX_ARGUMENT_BYTES = 8 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES = 32 * 1024;

export function mergeNestedCallMetadata(
	items: ConversationItem[],
	indices: Map<string, number>,
	result: unknown,
	parentToolCallId: string,
	timestamp: number,
	makeId: (callId: string) => string = () => id("nested-tool"),
): void {
	const source = objectRecord(result);
	if (objectRecord(source?.details)?.historical === true) return;
	const calls = objectRecord(source?.nestedCalls)?.calls;
	if (!Array.isArray(calls)) return;
	let argumentBytes = 0;
	for (const value of calls.slice(0, MAX_CALLS)) {
		const call = objectRecord(value);
		if (typeof call?.id !== "string" || !call.id || call.id === parentToolCallId ||
			typeof call.name !== "string" || !call.name ||
			(call.status !== "ok" && call.status !== "error" && call.status !== "unfinished")) continue;
		const found = indices.get(call.id);
		const previous = found === undefined ? undefined : items[found];
		if (previous && previous.kind !== "tool") continue;
		// A completed observation wins over an older unfinished snapshot that
		// can follow an overlaid completion when restoring a session.
		if (previous?.kind === "tool" && call.status === "unfinished" &&
			(previous.recordedNestedStatus === "ok" || previous.recordedNestedStatus === "error" ||
				(!previous.recordedNestedStatus && (previous.status === "done" || previous.status === "error")))) continue;
		let args = objectRecord(call.arguments);
		if (args) {
			try {
				const bytes = Buffer.byteLength(JSON.stringify(args));
				if (bytes > MAX_ARGUMENT_BYTES || argumentBytes + bytes > MAX_TOTAL_ARGUMENT_BYTES) args = undefined;
				else argumentBytes += bytes;
			} catch { args = undefined; }
		}
		const error = typeof call.error === "string" ? call.error.slice(0, 500) : "";
		const metadataOnly = !previous || Boolean(previous.recordedNestedStatus);
		const item: ToolItem = {
			...(previous?.kind === "tool" ? previous : {
				kind: "tool", id: makeId(call.id), toolCallId: call.id,
				name: call.name, timestamp, output: "", args: undefined, status: "done", isError: false,
			}),
			parentToolCallId: previous?.parentToolCallId ?? parentToolCallId,
			args: previous?.args ?? args,
			status: call.status === "error" ? "error" :
				call.status === "ok" ? "done" : previous?.status ?? "done",
			isError: call.status === "error",
			...(metadataOnly ? {
				recordedNestedStatus: call.status,
				output: error ? "Recorded error: " + error : "",
			} : {}),
		};
		if (found === undefined) {
			indices.set(call.id, items.length);
			items.push(item);
		} else items[found] = item;
	}
}
