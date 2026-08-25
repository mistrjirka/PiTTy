export const COLLAPSED_PASTE_CHAR_THRESHOLD = 800;
export const COLLAPSED_PASTE_LINE_THRESHOLD = 2;

export type PromptPasteBlock = {
	id: string;
	token: string;
	text: string;
	lineCount: number;
	charCount: number;
	leadingSeparator?: string;
	trailingSeparator?: string;
};

export type PromptPasteInsertion = {
	text: string;
	block: PromptPasteBlock;
	start: number;
	end: number;
};

export type PromptPasteRange = {
	start: number;
	end: number;
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

export function insertPromptPasteBlock(
	visibleText: string,
	block: PromptPasteBlock,
	start: number,
	end: number,
): PromptPasteInsertion {
	const leadingSeparator = start > 0 && !/\s/.test(visibleText[start - 1] ?? "") ? " " : "";
	const trailingSeparator =
		end < visibleText.length && !/[\s\n]/.test(visibleText[end] ?? "") ? " " : "";
	const inserted = `${leadingSeparator}${block.token}${trailingSeparator}`;
	return {
		text: `${visibleText.slice(0, start)}${inserted}${visibleText.slice(end)}`,
		block: { ...block, leadingSeparator, trailingSeparator },
		start: start + leadingSeparator.length,
		end: start + inserted.length - trailingSeparator.length,
	};
}

export function promptPasteRange(
	visibleText: string,
	block: PromptPasteBlock,
): PromptPasteRange | undefined {
	const tokenStart = visibleText.indexOf(block.token);
	if (tokenStart < 0) return undefined;
	const start =
		block.leadingSeparator && tokenStart >= block.leadingSeparator.length &&
		visibleText.slice(tokenStart - block.leadingSeparator.length, tokenStart) === block.leadingSeparator
			? tokenStart - block.leadingSeparator.length
			: tokenStart;
	const tokenEnd = tokenStart + block.token.length;
	const end =
		block.trailingSeparator && visibleText.slice(tokenEnd, tokenEnd + block.trailingSeparator.length) === block.trailingSeparator
			? tokenEnd + block.trailingSeparator.length
			: tokenEnd;
	return { start, end };
}

export function promptPasteDeletionRange(
	visibleText: string,
	blocks: readonly PromptPasteBlock[],
	cursorOffset: number,
	direction: PromptPasteDeletionDirection,
	selection: { start: number; end: number } | null = null,
): { start: number; end: number } | undefined {
	for (const block of blocks) {
		const range = promptPasteRange(visibleText, block);
		if (!range) continue;
		const { start, end } = range;
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
			const removalStart =
				block.leadingSeparator &&
					start >= block.leadingSeparator.length &&
					sanitized.slice(start - block.leadingSeparator.length, start) === block.leadingSeparator
					? start - block.leadingSeparator.length
					: start;
			const removalEnd =
				block.trailingSeparator &&
					sanitized.slice(end, end + block.trailingSeparator.length) === block.trailingSeparator
					? end + block.trailingSeparator.length
					: end;
			sanitized = `${sanitized.slice(0, removalStart)}${sanitized.slice(removalEnd)}`;
			searchFrom = removalStart;
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
	for (const block of blocks) {
		const range = promptPasteRange(expanded, block);
		if (!range) continue;
		expanded = `${expanded.slice(0, range.start)}${block.text}${expanded.slice(range.end)}`;
	}
	return expanded;
}
