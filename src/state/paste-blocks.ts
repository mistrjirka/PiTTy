export const COLLAPSED_PASTE_CHAR_THRESHOLD = 800;
export const COLLAPSED_PASTE_LINE_THRESHOLD = 2;

export type PromptPasteBlock = {
	id: string;
	token: string;
	text: string;
	lineCount: number;
	charCount: number;
};

export function countLines(value: string): number {
	if (!value) return 0;
	return value.split(/\r?\n/).length;
}

export function shouldCollapsePromptPaste(value: string): boolean {
	const lineCount = countLines(value);
	return (
		lineCount > COLLAPSED_PASTE_LINE_THRESHOLD ||
		value.length > COLLAPSED_PASTE_CHAR_THRESHOLD
	);
}

export function createPromptPasteBlock(
	text: string,
	existing: readonly PromptPasteBlock[],
): PromptPasteBlock {
	const id = crypto.randomUUID();
	const lineCount = countLines(text);
	const charCount = text.length;
	const token = `[Pasted text #${existing.length + 1} +${Math.max(0, lineCount - 1)} lines - click to expand]`;
	return { id, token, text, lineCount, charCount };
}

export type PromptPasteDeletionDirection = "backward" | "forward";

export function promptPasteDeletionRange(
	visibleText: string,
	blocks: readonly PromptPasteBlock[],
	cursorOffset: number,
	direction: PromptPasteDeletionDirection,
	selection: { start: number; end: number } | null = null,
): { start: number; end: number } | undefined {
	for (const block of blocks) {
		const start = visibleText.indexOf(block.token);
		if (start < 0) continue;
		const end = start + block.token.length;
		if (selection && selection.start < end && selection.end > start)
			return { start, end };
		if (direction === "backward" && cursorOffset > start && cursorOffset <= end)
			return { start, end };
		if (direction === "forward" && cursorOffset >= start && cursorOffset < end)
			return { start, end };
	}
	return undefined;
}

export function stripCollapsedPromptPasteFragments(
	visibleText: string,
	blocks: readonly PromptPasteBlock[],
): string {
	let sanitized = visibleText;
	for (const block of blocks) {
		if (sanitized.includes(block.token)) continue;
		const tokenPrefix = block.token.slice(0, 16);
		let searchFrom = 0;
		for (;;) {
			const start = sanitized.indexOf(tokenPrefix, searchFrom);
			if (start < 0) break;
			const newline = sanitized.indexOf("\n", start);
			const closingBracket = sanitized.indexOf("]", start);
			let end: number;
			if (closingBracket >= 0 && (newline < 0 || closingBracket < newline)) {
				end = closingBracket + 1;
			} else {
				let matchingLength = 0;
				while (
					matchingLength < block.token.length &&
					sanitized[start + matchingLength] === block.token[matchingLength]
				) {
					matchingLength += 1;
				}
				end = start + matchingLength;
			}
			sanitized = `${sanitized.slice(0, start)}${sanitized.slice(end)}`;
			searchFrom = start;
		}
	}
	return sanitized;
}

export function prunePromptPasteBlocks(
	visibleText: string,
	blocks: readonly PromptPasteBlock[],
): PromptPasteBlock[] {
	return blocks.filter((block) => visibleText.includes(block.token));
}

export function expandPromptPasteTokens(
	visibleText: string,
	blocks: readonly PromptPasteBlock[],
): string {
	let expanded = visibleText;
	for (const block of blocks)
		expanded = expanded.replace(block.token, block.text);
	return expanded;
}
