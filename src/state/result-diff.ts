export type DiffResult = {
  diff?: string;
  path?: string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

const MAX_NORMALIZED_DIFF_ENTRIES = 2_000;
const MAX_NORMALIZED_DIFF_CHARS = 100_000;
const MAX_NORMALIZED_DIFF_LINE_CHARS = 4_096;
const DIFF_TRUNCATION_MARKER = "… diff truncated …";

function limitDiffLine(value: string): string {
	return value.length > MAX_NORMALIZED_DIFF_LINE_CHARS
		? `${value.slice(0, MAX_NORMALIZED_DIFF_LINE_CHARS - 1)}…`
		: value;
}

function boundRawDiff(value: string): string {
	const sourceLines = value.split(/\r?\n/, MAX_NORMALIZED_DIFF_ENTRIES + 1);
	let truncated = sourceLines.length > MAX_NORMALIZED_DIFF_ENTRIES;
	const lines: string[] = [];
	let characterCount = 0;
	for (const sourceLine of sourceLines.slice(0, MAX_NORMALIZED_DIFF_ENTRIES)) {
		if (sourceLine.length > MAX_NORMALIZED_DIFF_LINE_CHARS) truncated = true;
		const line = limitDiffLine(sourceLine);
		const separatorLength = lines.length > 0 ? 1 : 0;
		const nextCount = characterCount + separatorLength + line.length;
		if (nextCount > MAX_NORMALIZED_DIFF_CHARS) {
			truncated = true;
			break;
		}
		lines.push(line);
		characterCount = nextCount;
	}
	if (truncated) lines.push(DIFF_TRUNCATION_MARKER);
	return lines.join("\n");
}
function entryLine(entry: unknown): string | undefined {
	if (typeof entry === "string") return limitDiffLine(entry);
	const value = record(entry);
	if (!value) return undefined;
	const rawText =
		typeof value.text === "string"
			? value.text
			: typeof value.content === "string"
				? value.content
				: typeof value.line === "string"
					? value.line
					: undefined;
	if (rawText === undefined) return undefined;
	const text = limitDiffLine(rawText);
	const kind =
		typeof value.type === "string"
			? value.type
			: typeof value.kind === "string"
				? value.kind
				: typeof value.operation === "string"
					? value.operation
					: "";
	let prefix = "";
	if (["add", "added", "insert", "addition"].includes(kind)) prefix = "+ ";
	else if (["remove", "removed", "delete", "deletion"].includes(kind))
		prefix = "- ";
	else if (["context", "unchanged"].includes(kind)) prefix = "  ";
	return `${prefix}${text}`;
}

function structuredDiff(entries: unknown[]): string | undefined {
	const lines: string[] = [];
	let characterCount = 0;
	let truncated = false;
	let entryCount = 0;
	for (const entry of entries) {
		if (entryCount >= MAX_NORMALIZED_DIFF_ENTRIES) {
			truncated = true;
			break;
		}
		entryCount += 1;
		const line = entryLine(entry);
		if (line === undefined) continue;
		const separatorLength = lines.length > 0 ? 1 : 0;
		const nextCount = characterCount + separatorLength + line.length;
		if (nextCount > MAX_NORMALIZED_DIFF_CHARS) {
			truncated = true;
			break;
		}
		lines.push(line);
		characterCount = nextCount;
	}
	if (truncated) lines.push(DIFF_TRUNCATION_MARKER);
	return lines.length > 0 ? lines.join("\n") : undefined;
}
export function normalizeResultDetails(detailsValue: unknown): DiffResult {
  const details = record(detailsValue);
  if (!details) return {};
	const readSeekValue = record(details.readSeekValue);
	const legacyPatch =
		typeof details.patch === "string" && details.patch.trim()
			? details.patch
			: typeof readSeekValue?.patch === "string"
				? readSeekValue.patch
				: undefined;
	const direct = details.path ?? details.filePath ?? details.file_path;
	const path =
		typeof direct === "string" && direct.trim()
			? direct.trim()
			: typeof readSeekValue?.path === "string" && readSeekValue.path.trim()
				? readSeekValue.path.trim()
				: undefined;
	if (typeof legacyPatch === "string" && legacyPatch.trim())
		return { diff: boundRawDiff(legacyPatch), ...(path ? { path } : {}) };
	const diffData =
		record(details.diffData) ?? record(readSeekValue?.diffData);
	const entries = diffData?.entries;
	if (Array.isArray(entries)) {
		const diff = structuredDiff(entries);
		if (diff) return { diff, ...(path ? { path } : {}) };
	}
	const diff =
		typeof details.diff === "string" && details.diff.trim()
			? details.diff
			: readSeekValue?.diff;
	return (
		typeof diff === "string" && diff.trim()
			? { diff: boundRawDiff(diff), ...(path ? { path } : {}) }
			: path
				? { path }
				: {}
	);
}
