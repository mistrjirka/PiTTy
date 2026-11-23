/** Compact, factual labels for tool arguments without showing escaped JSON. */
import { cleanTerminalText, objectRecordValue, prettyArgs, toolArgSummary } from "./message-format.tsx";

export type ToolInputDetail = { title: string; text: string };

const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string, length: number) =>
	text.length <= length ? text : `${text.slice(0, length - 1)}…`;

export function toolCallArgSummary(name: string, args: unknown): string {
	const fields = objectRecordValue(args);
	if (name === "code" && typeof fields?.code === "string") {
		const code = fields.code.trimEnd();
		const count = code ? code.split(/\r?\n/).length : 0;
		return count > 1 ? `Python · ${count} lines` :
			count === 1 ? `Python · ${clip(compact(code), 75)}` : "Python · empty";
	}
	if (name === "agent_wait") {
		const id = typeof fields?.agent_id === "string" ? fields.agent_id.trim() :
			typeof fields?.agentId === "string" ? fields.agentId.trim() : "";
		return id ? `for ${clip(id, 65)}` : "";
	}
    const basic = toolArgSummary(args);
	if (!fields || !basic.startsWith("{")) return basic;
	const parts = Object.entries(fields).slice(0, 3).map(([key, value]) => {
		let concise: string;
		if (typeof value === "string") concise = clip(compact(cleanTerminalText(value)), 45);
		else if (typeof value === "number" || typeof value === "boolean") concise = String(value);
		else if (Array.isArray(value)) concise = `${value.length} items`;
		else if (value && typeof value === "object") concise = "object";
		else concise = "null";
		return `${key}=${concise}`;
	});
	if (Object.keys(fields).length > 3) parts.push(`+${Object.keys(fields).length - 3} more`);
	return clip(parts.join(" · "), 150);
}

/**
 * Reveals a source script or the complete original parameters only on demand.
 * This is presentation-only. The original tool arguments are never modified.
 */
export function toolInputDetail(name: string, args: unknown): ToolInputDetail | undefined {
	const fields = objectRecordValue(args);
	if (name === "code" && typeof fields?.code === "string")
		return { title: "Python source", text: fields.code };
	if (name === "agent_spawn" && typeof fields?.prompt === "string")
		return { title: "Agent request", text: fields.prompt };
	const source = fields && ["command", "cmd"].map((key) => fields[key])
		.find((v): v is string => typeof v === "string" && v.trim().length > 0);
	if (source && (source.length > 135 || source.includes("\n")))
		return { title: "Command", text: source };
	const raw = prettyArgs(args);
	if (raw.length > 150)
		return { title: "Tool input", text: raw };
	return undefined;
}

export function isRedundantSpawnReceipt(name: string, output: string, isError: boolean): boolean {
	return name === "agent_spawn" && !isError &&
		/^Started background agent @[\w-]+\. Completion arrives in (?:the )?next tool result or notification\.$/.test(output.trim());
}

/** Parse only bounded, standalone JSON results; mixed log text stays untouched. */
export function structuredToolOutput(output: string): { preview: string; expanded: string } | undefined {
	if (output.length > 200_000) return undefined;
	const clean = cleanTerminalText(output).trim();
	if (!((clean.startsWith("{") && clean.endsWith("}")) ||
		(clean.startsWith("[") && clean.endsWith("]")))) return undefined;
	let value: unknown;
	try { value = JSON.parse(clean); } catch { return undefined; }
	if (value === null || typeof value !== "object") return undefined;
	const isArray = Array.isArray(value);
	const fields = isArray ? [] : Object.keys(value);
	const count = Array.isArray(value) ? value.length : fields.length;
	const status = !isArray ? (value as Record<string, unknown>).status : undefined;
	const message = !isArray ? (value as Record<string, unknown>).message : undefined;
	const relevant = typeof message === "string" && message.trim() ? message :
		typeof status === "string" && status.trim() ? `status: ${status}` : "";
	const noun = isArray ? (count === 1 ? "item" : "items") : (count === 1 ? "field" : "fields");
	return {
		preview: `JSON · ${count} ${noun}${relevant ? ` · ${clip(compact(relevant), 58)}` : ""}`,
		expanded: JSON.stringify(value, null, 2),
	};
}
