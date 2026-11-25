/** Code execution state is separate from completion of its foreground tool call. */
import type { CodeCellObservation, ConversationItem, ToolItem } from "../types.ts";
import { objectRecord } from "./conversation-shared.ts";

type ToolStatusSource = Pick<ToolItem, "status" | "isError"> &
	Partial<Pick<ToolItem, "name" | "details" | "codeCell" | "recordedNestedStatus">>;
type CodeStatus = CodeCellObservation["resultStatus"];
export type ToolDisplayState = {
	kind: "yielded" | "paused" | "unknown" | "error" | "ok" | "saved";
	label: string;
};

export function codeResultStatus(name: string | undefined, details: unknown): CodeStatus | undefined {
	if (name?.toLowerCase() !== "code") return undefined;
	const status = objectRecord(details)?.status;
	return status === "running" || status === "suspended" || status === "unknown" ||
		status === "error" || status === "ok" ? status : undefined;
}

export function codeCellObservation(name: string, details: unknown): CodeCellObservation | undefined {
	const record = objectRecord(details);
	if (record?.historical === true) return undefined;
	const resultStatus = codeResultStatus(name, details);
	const cell = objectRecord(record?.cell);
	if (!resultStatus || typeof cell?.id !== "string" || !cell.id) return undefined;
	const status = cell.status;
	if (status !== "complete" && status !== "unknown" && status !== "running") return undefined;
	// Output pages can carry the currently pending cell in control details.
	// Reading saved output does not observe or collect that execution.
	if (status === "running" && resultStatus !== "running") return undefined;
	return { id: cell.id, status, resultStatus };
}

function withCellObservation(item: ToolItem, observation: CodeCellObservation): ToolItem {
	const previous = item.codeCell;
	if (previous?.status === "complete" && observation.status !== "complete") return item;
	if (previous?.status === observation.status && previous.resultStatus === observation.resultStatus &&
		(observation.status !== "complete" || !item.yieldedOutput)) return item;
	return {
		...item,
		codeCell: observation,
		...(observation.status === "complete" ? { yieldedOutput: undefined } : {}),
	};
}

/** Apply the latest actual observation without rewriting the original result. */
export function reconcileCodeCell(items: ConversationItem[], observation: CodeCellObservation): void {
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (item?.kind === "tool" && codeCellObservation(item.name, item.details)?.id === observation.id)
			items[index] = withCellObservation(item, observation);
	}
}

export function reconcileCodeCellHistory(items: ConversationItem[]): void {
	const observations = new Map<string, CodeCellObservation>();
	for (const item of items) {
		if (item.kind !== "tool") continue;
		const observation = codeCellObservation(item.name, item.details);
		if (observation && !(observations.get(observation.id)?.status === "complete" && observation.status !== "complete"))
			observations.set(observation.id, observation);
	}
	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		if (item?.kind !== "tool") continue;
		const ownCell = codeCellObservation(item.name, item.details);
		const observation = ownCell ? observations.get(ownCell.id) : undefined;
		if (observation) items[index] = withCellObservation(item, observation);
	}
}

export function toolDisplayState(item: ToolStatusSource): ToolDisplayState | undefined {
	if (item.recordedNestedStatus) return {
		kind: item.recordedNestedStatus === "unfinished" ? "unknown" :
			item.recordedNestedStatus === "error" ? "error" : "ok",
		label: item.recordedNestedStatus === "unfinished" ? "recorded · unfinished" : "recorded",
	};
	if (item.name?.toLowerCase() !== "code" || item.status === "streaming" || item.status === "pending")
		return undefined;
	if (objectRecord(item.details)?.historical === true) return { kind: "saved", label: "saved result" };
	const status = codeResultStatus(item.name, item.details);
	if (item.codeCell?.status === "complete" && (status === "running" || status === "unknown")) {
		const final = item.codeCell.resultStatus;
		return final === "suspended" ? { kind: "paused", label: "collected · paused" } :
			final === "error" ? { kind: "error", label: "collected · failed" } :
				{ kind: "ok", label: "collected" };
	}
	if (status === "running") return { kind: "yielded", label: "yielded" };
	if (status === "suspended") return { kind: "paused", label: "paused" };
	if (status === "unknown") return { kind: "unknown", label: "unconfirmed" };
	if (status === "error") return { kind: "error", label: "failed" };
	return undefined;
}

/** Retain at most a small head/tail of stdout until a collection owns its final output. */
export function retainYieldedOutput(output: string): string {
	const maxChars = 7 * 1024;
	if (output.length <= maxChars) return output;
	const half = Math.floor((maxChars - 28) / 2);
	return output.slice(0, half) + "\n[... preview omitted ...]\n" + output.slice(-half);
}

export function displayToolOutput(item: ToolItem): string {
	const cell = item.codeCell;
	const rawStatus = codeResultStatus(item.name, item.details);
	if (cell?.status === "complete" && (rawStatus === "running" || rawStatus === "unknown")) {
		const outcome = cell.resultStatus === "suspended" ? "The script paused." :
			cell.resultStatus === "error" ? "The execution failed." : "The execution finished.";
		return `Code cell ${cell.id} was collected. ${outcome} See its collection result.`;
	}
	return item.yieldedOutput ? item.yieldedOutput + "\n" + item.output : item.output;
}
