export type SubagentArgs = Record<string, unknown>;

function argsRecord(args: unknown): SubagentArgs | undefined {
	return args !== null && typeof args === "object" && !Array.isArray(args)
		? (args as SubagentArgs)
		: undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function summarizeSubagentArgs(args: unknown): string | undefined {
	const record = argsRecord(args);
	if (!record) return undefined;
	const name = nonEmptyString(record.agent);
	const model = nonEmptyString(record.model);
	const mode = nonEmptyString(record.mode) ?? (record.workflow !== undefined ? "workflow" : undefined);
	const countValue =
		typeof record.count === "number" && Number.isFinite(record.count)
			? record.count
			: typeof record.children === "number" && Number.isFinite(record.children)
				? record.children
				: Array.isArray(record.tasks)
					? record.tasks.length
					: undefined;
	const count = countValue === undefined ? "" : ` ×${countValue}`;
	const parts = [name, model, mode].filter((part): part is string => part !== undefined);
	return parts.length ? `${parts.join(" · ")}${count}` : undefined;
}

export function taskGist(args: unknown): string | undefined {
	const task = nonEmptyString(argsRecord(args)?.task);
	if (!task) return undefined;
	const normalized = task.replace(/\s+/g, " ").trim();
	return normalized.length > 90 ? `${normalized.slice(0, 89)}…` : normalized;
}

export function terminalBadge(
	status: string,
	isError: boolean,
	timingText: string,
): string | undefined {
	if (isError || status === "error" || status === "failed") return "✗ failed";
	if (status === "completed" || status === "done") return timingText ? `✓ completed · ${timingText}` : "✓ completed";
	return undefined;
}

function childrenSummary(record: SubagentArgs | undefined): string | undefined {
	if (!record) return undefined;
	const results = record.results;
	if (Array.isArray(results)) return `×${results.length} children`;
	const children = argsRecord(record.details)?.children;
	return typeof children === "number" && Number.isFinite(children) && children >= 0
		? `×${children} children`
		: undefined;
}

export function workflowChildrenSummary(args: unknown, output: unknown): string | undefined {
	// Prefer args: the spawn request is what the card did. Coincidental JSON
	// in the output (echoed fixtures, pasted examples) must not fabricate a
	// "×N children" badge on a card that spawned nothing — output is only
	// consulted when args has no spawn shape at all.
	const parsedOutput = typeof output === "string" ? parseObject(output) : argsRecord(output);
	return childrenSummary(argsRecord(args)) ?? childrenSummary(parsedOutput);
}

function parseObject(value: string): SubagentArgs | undefined {
	try {
		return argsRecord(JSON.parse(value));
	} catch {
		return undefined;
	}
}
