/** One session's prompt draft and collapsed-paste editing policy. */
import type { KeyEvent, PasteEvent, TextareaRenderable } from "@opentui/core";
import type { Setter } from "solid-js";
import { queuedPromptMatchesDraft, type SessionDrafts, sessionDrafts } from "../state/input-continuity.ts";
import { createPromptPasteBlock, expandPromptPasteTokens, insertPromptPasteBlock, promptPasteDeletionRange, promptPasteRange, prunePromptPasteBlocks, shouldCollapsePromptPaste } from "../state/paste-blocks.ts";
import type { Toast } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import { promptPlaceholder } from "../ui/prompt-composer.tsx";

export interface PromptDraftPorts {
	cwd: string;
	currentSessionKey: () => string;
	revision: () => number;
	activeRuntime: () => ConversationTabRuntime;
	isRuntimeActive: (id: string) => boolean;
	getPrompt: () => TextareaRenderable | undefined;
	setPromptText: Setter<string>;
	setPromptCursorOffset: Setter<number>;
	setCommandSuggestionIndex: Setter<number>;
	toast: (text: string, tone: Toast["tone"], duration?: number) => void;
}

export interface PromptDraftActions {
	currentDrafts: () => SessionDrafts;
	syncPromptPlaceholder: (text: string) => void;
	syncMainDraft: (text: string, preservePastes?: boolean) => void;
	clearMainDraft: () => void;
	runtimeMainDraftText: (runtime: ConversationTabRuntime) => string;
	clearRuntimeMainDraft: (runtime: ConversationTabRuntime) => void;
	syncRuntimeMainDraft: (runtime: ConversationTabRuntime, text: string) => void;
	clearRuntimeMainDraftIfMatches: (
		runtime: ConversationTabRuntime,
		expected: string,
	) => void;
	promptValue: () => string;
	expandedPromptText: () => string;
	expandCollapsedPromptPaste: (blockId: string) => void;
	handlePromptKeyDown: (event: KeyEvent) => void;
	handlePromptPaste: (event: PasteEvent) => void;
}

export function createPromptDraftActions(
	ports: PromptDraftPorts,
): PromptDraftActions {
	const currentDrafts = () => {
		ports.revision();
		return sessionDrafts(
			ports.activeRuntime().drafts,
			ports.currentSessionKey(),
		);
	};
	const mainPromptPlaceholder = () =>
		promptPlaceholder(ports.activeRuntime().conversation.isStreaming);
	const syncPromptPlaceholder = (text: string) => {
		const prompt = ports.getPrompt();
		if (prompt)
			prompt.placeholder = text.length > 0 ? null : mainPromptPlaceholder();
	};
	const syncMainDraft = (text: string, preservePastes = false) => {
		const prompt = ports.getPrompt();
		const drafts = currentDrafts();
		drafts.main = text;
		drafts.mainPastes = preservePastes
			? prunePromptPasteBlocks(text, drafts.mainPastes)
			: [];
		if (prompt && prompt.plainText !== text) prompt.setText(text);
		syncPromptPlaceholder(text);
		ports.setPromptText(text);
		ports.setPromptCursorOffset(prompt?.cursorOffset ?? text.length);
	};
	const clearMainDraft = () => {
		const prompt = ports.getPrompt();
		const drafts = currentDrafts();
		drafts.main = "";
		drafts.mainPastes = [];
		prompt?.clear();
		syncPromptPlaceholder("");
		ports.setPromptText("");
		ports.setPromptCursorOffset(0);
	};
	const runtimeMainDraftText = (runtime: ConversationTabRuntime): string => {
		const drafts = sessionDrafts(
			runtime.drafts,
			runtime.sessionState?.sessionId ?? ports.cwd,
		);
		return expandPromptPasteTokens(drafts.main, drafts.mainPastes);
	};
	const syncRuntimeMainDraft = (runtime: ConversationTabRuntime, text: string): void => {
		if (ports.isRuntimeActive(runtime.id)) {
			syncMainDraft(text);
			return;
		}
		const drafts = sessionDrafts(runtime.drafts, runtime.sessionState?.sessionId ?? ports.cwd);
		drafts.main = text;
		drafts.mainPastes = [];
	};
	const clearRuntimeMainDraft = (runtime: ConversationTabRuntime): void => {
		if (ports.isRuntimeActive(runtime.id)) {
			clearMainDraft();
			return;
		}
		const drafts = sessionDrafts(
			runtime.drafts,
			runtime.sessionState?.sessionId ?? ports.cwd,
		);
		drafts.main = "";
		drafts.mainPastes = [];
	};
	const clearRuntimeMainDraftIfMatches = (
		runtime: ConversationTabRuntime,
		expected: string,
	): void => {
		if (queuedPromptMatchesDraft(runtimeMainDraftText(runtime), expected))
			clearRuntimeMainDraft(runtime);
	};
	const promptValue = () =>
		ports.getPrompt()?.plainText ?? currentDrafts().main;
	const expandedPromptText = () =>
		expandPromptPasteTokens(promptValue(), currentDrafts().mainPastes);
	const expandCollapsedPromptPaste = (blockId: string) => {
		const prompt = ports.getPrompt();
		const drafts = currentDrafts();
		const block = drafts.mainPastes.find((entry) => entry.id === blockId);
		if (!block) return;
		const range = promptPasteRange(drafts.main, block);
		if (!range) return;
		const nextText = `${drafts.main.slice(0, range.start)}${block.text}${drafts.main.slice(range.end)}`;
		drafts.main = nextText;
		drafts.mainPastes = drafts.mainPastes.filter(
			(entry) => entry.id !== blockId,
		);
		if (prompt) {
			prompt.placeholder = null;
			prompt.replaceText(nextText);
			prompt.cursorOffset = range.start + block.text.length;
			prompt.focus();
		}
		ports.setPromptText(nextText);
		ports.setPromptCursorOffset(
			prompt?.cursorOffset ?? range.start + block.text.length,
		);
		ports.setCommandSuggestionIndex(0);
	};
	const handlePromptKeyDown = (event: KeyEvent) => {
		const prompt = ports.getPrompt();
		if (!prompt || (event.name !== "backspace" && event.name !== "delete"))
			return;
		const direction = event.name === "backspace" ? "backward" : "forward";
		const range = promptPasteDeletionRange(
			prompt.plainText,
			currentDrafts().mainPastes,
			prompt.cursorOffset,
			direction,
			prompt.getSelection(),
		);
		if (!range) return;
		event.preventDefault();
		event.stopPropagation();
		const nextText = `${prompt.plainText.slice(0, range.start)}${prompt.plainText.slice(range.end)}`;
		const nextCursor = Math.min(range.start, nextText.length);
		prompt.replaceText(nextText);
		prompt.cursorOffset = nextCursor;
		const drafts = currentDrafts();
		drafts.main = nextText;
		drafts.mainPastes = prunePromptPasteBlocks(nextText, drafts.mainPastes);
		syncPromptPlaceholder(nextText);
		ports.setPromptText(nextText);
		ports.setPromptCursorOffset(nextCursor);
		ports.setCommandSuggestionIndex(0);
	};
	const handlePromptPaste = (event: PasteEvent) => {
		const prompt = ports.getPrompt();
		const text = new TextDecoder().decode(event.bytes);
		if (!shouldCollapsePromptPaste(text)) return;
		event.preventDefault();
		event.stopPropagation();
		const drafts = currentDrafts();
		const existing = drafts.mainPastes.find(
			(block) => block.text === text && drafts.main.includes(block.token),
		);
		if (existing) {
			expandCollapsedPromptPaste(existing.id);
			ports.toast("Pasted block expanded for editing.", "info");
			return;
		}
		const block = createPromptPasteBlock(text, drafts.mainPastes);
		const currentText = prompt?.plainText ?? drafts.main;
		const selection = prompt?.getSelection();
		const insertionStart =
			selection?.start ?? prompt?.cursorOffset ?? currentText.length;
		const insertionEnd = selection?.end ?? insertionStart;
		const insertion = insertPromptPasteBlock(
			currentText,
			block,
			insertionStart,
			insertionEnd,
		);
		const nextText = insertion.text;
		const nextBlocks = prunePromptPasteBlocks(nextText, [
			...drafts.mainPastes,
			insertion.block,
		]);
		drafts.main = nextText;
		drafts.mainPastes = nextBlocks;
		if (prompt) {
			// OpenTUI stores placeholder rendering separately from editor text. Clear
			// it synchronously before replacing an untouched editor's contents.
			prompt.placeholder = null;
			prompt.replaceText(nextText);
			prompt.cursorOffset =
				insertion.end + insertion.block.trailingSeparator!.length;
		}
		ports.setPromptText(nextText);
		ports.setPromptCursorOffset(
			insertion.end + insertion.block.trailingSeparator!.length,
		);
		ports.setCommandSuggestionIndex(0);
		ports.toast(
			`Pasted ${block.lineCount} line${block.lineCount === 1 ? "" : "s"}. Paste again or click to expand.`,
			"info",
		);
	};

	return {
		currentDrafts,
		syncPromptPlaceholder,
		syncMainDraft,
		clearMainDraft,
		runtimeMainDraftText,
		clearRuntimeMainDraft,
		syncRuntimeMainDraft,
		clearRuntimeMainDraftIfMatches,
		promptValue,
		expandedPromptText,
		expandCollapsedPromptPaste,
		handlePromptKeyDown,
		handlePromptPaste,
	};
}
