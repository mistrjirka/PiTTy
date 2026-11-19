/** Keyboard-only event routing. Session, UI, and RPC state stay in App. */
import { useKeyboard } from "@opentui/solid";
import type { KeyboardPorts } from "./app-keyboard-contracts.ts";
import { handleModalKey } from "./app-keyboard-modal.ts";
import { handleSuggestionKey } from "./app-keyboard-suggestions.ts";
import { inspectedTargetScrollY } from "../ui/subagent-inspector.tsx";
import { createDiagnosticBundle } from "../diagnostics/bundle.ts";
import { shouldRecoverPromptDraft } from "../state/prompt-history.ts";
import {
	hasAlt,
	isEnterKey,
	keyIs,
	nextDetailToggle,
	subagentInspectDecision,
	subagentNavigationAction,
	streamingCtrlCDecision,
} from "../ui/app-navigation.ts";

export function registerAppKeyboard(ports: KeyboardPorts): void {
	const {
		abortActiveWork,
		activeRuntime,
		availableSubagentTargets,
		clearMainDraft,
		closeSubagentInspector,
		compactionExpanded,
		copySelection,
		cycleSubagent,
		cycleThinkingEffort,
		dimensions,
		displaySubagentTargets,
		expandedPromptText,
		expandedTools,
		focusMainPrompt,
		inspectSubagent,
		openMemoryBrowser,
		openModelSelector,
		openPromptMap,
		openSettings,
		queueFollowUp,
		renderer,
		requestPauseSubagent,
		requestStopSubagent,
		restoreQueuedFollowUp,
		setAllThinkingExpanded,
		setCompactionExpanded,
		setExpandedToolIds,
		setExpandedTools,
		setInspectSubagent,
		setPromptCursorOffset,
		setSelectedTargetKey,
		setSidebarEnabled,
		setSubagentSelectorOpen,
		streaming,
		subagentsAvailable,
		syncMainDraft,
		thinkingExpanded,
		toast,
		updateScrollPosition,
	} = ports;
	let lastCtrlC = 0;
	useKeyboard((event) => {
		const prompt = ports.getPrompt();
		const scroll = ports.getScroll();
		const subagentScroll = ports.getSubagentScroll();
		if (handleModalKey(event, ports)) return;
		if (event.name === "escape" && !inspectSubagent() && activeRuntime().pendingInputEdit) {
			event.preventDefault();
			event.stopPropagation();
			ports.cancelPendingEdit();
			return;
		}
		const suggestionDecision = handleSuggestionKey(event, ports, prompt);
		if (suggestionDecision === "pass") return false;
		if (suggestionDecision === "handled") return;
		if (!inspectSubagent() && hasAlt(event) && isEnterKey(event)) {
			event.preventDefault();
			event.stopPropagation();
			queueFollowUp();
			return;
		}
		if (!inspectSubagent() && hasAlt(event) && event.name === "up") {
			event.preventDefault();
			event.stopPropagation();
			restoreQueuedFollowUp();
			return;
		}
		const navigation = subagentNavigationAction(
			inspectSubagent(),
			event.name,
			event,
		);
		if (navigation) {
			event.preventDefault();
			event.stopPropagation();
			if (navigation === "previous") cycleSubagent(-1);
			else if (navigation === "next") cycleSubagent(1);
			else if (navigation === "main") closeSubagentInspector();
			else {
				const targets = availableSubagentTargets();
				if (!subagentsAvailable())
					toast(
						"Install a supported subagent runtime to inspect and steer child agents",
						"info",
						5000,
					);
				else if (targets.length === 0) toast("No subagent selected", "warning");
				else if (targets.length > 1) setSubagentSelectorOpen(true);
				else {
					const target = targets[0];
					if (target) {
						setSelectedTargetKey(target.key);
						setInspectSubagent(true);
						queueMicrotask(() =>
							subagentScroll?.scrollTo(inspectedTargetScrollY(target)),
						);
					}
				}
			}
			return;
		}
		if (event.ctrl && event.name === "c") {
			event.preventDefault();
			event.stopPropagation();
			if (copySelection()) return;
			const draft = prompt?.plainText ?? "";
			if (
				prompt?.focused &&
				shouldRecoverPromptDraft({ draft, hasCopyableSelection: false })
			) {
				activeRuntime().promptHistory.recordDraft(expandedPromptText());
				clearMainDraft();
				focusMainPrompt();
				toast("Draft saved. Press Up to recover it.", "info");
				return;
			}
			if (streaming()) {
				if (
					streamingCtrlCDecision(Boolean(activeRuntime().abortInFlight)) ===
					"force-exit"
				) {
					renderer.destroy();
					return;
				}
				abortActiveWork();
				return;
			}
			const now = Date.now();
			if (now - lastCtrlC < 800) renderer.destroy();
			else {
				lastCtrlC = now;
				toast("Press Ctrl+C again to exit", "info", 1000);
			}
			return;
		}
		if (
			!inspectSubagent() &&
			!event.ctrl &&
			!event.meta &&
			!event.shift &&
			!event.option &&
			!event.super &&
			!hasAlt(event) &&
			(event.name === "up" || event.name === "down") &&
			(prompt?.lineCount ?? 1) === 1
		) {
			const result = activeRuntime().promptHistory.browse(
				prompt?.plainText ?? "",
				event.name === "up" ? "older" : "newer",
			);
			if (result.handled) {
				event.preventDefault();
				event.stopPropagation();
				syncMainDraft(result.text ?? "");
				// Keep the caret at the start so slash autocomplete does not steal
				// further ArrowUp/Down presses while browsing history. Defer past
				// setText cursor/content callbacks that may briefly move the caret.
				queueMicrotask(() => {
					if (prompt) prompt.cursorOffset = 0;
					setPromptCursorOffset(0);
				});
				prompt?.focus();
				return;
			}
		}
		if (event.name === "pageup" || event.name === "pagedown") {
			event.preventDefault();
			event.stopPropagation();
			const page = Math.max(4, dimensions().height - 10);
			const target = inspectSubagent() ? subagentScroll : scroll;
			target?.scrollBy(event.name === "pageup" ? -page : page);
			queueMicrotask(updateScrollPosition);
			return;
		}
		if (keyIs(event, "home", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			(inspectSubagent() ? subagentScroll : scroll)?.scrollTo(0);
			queueMicrotask(updateScrollPosition);
			return;
		}
		if (keyIs(event, "end", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			(inspectSubagent() ? subagentScroll : scroll)?.scrollTo(
				Number.MAX_SAFE_INTEGER,
			);
			queueMicrotask(updateScrollPosition);
			return;
		}
		if (keyIs(event, "x", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			openSettings();
			return;
		}
		if (keyIs(event, "p", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			void openModelSelector();
			return;
		}
		if (keyIs(event, "r", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			openPromptMap();
			return;
		}
		if (keyIs(event, "m", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			openMemoryBrowser();
			return;
		}
		if (keyIs(event, "t", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			void cycleThinkingEffort();
			return;
		}
		if (event.name === "tab" && event.shift) {
			event.preventDefault();
			event.stopPropagation();
			void cycleThinkingEffort();
			return;
		}
		if (keyIs(event, "s", { ctrl: true })) {
			event.preventDefault();
			setSidebarEnabled((value) => !value);
			return;
		}
		if (keyIs(event, "o", { ctrl: true })) {
			event.preventDefault();
			const next = nextDetailToggle({
				toolsExpanded: expandedTools(),
				thinkingExpanded: thinkingExpanded(),
				compactionExpanded: compactionExpanded(),
				hasExpandedToolOverride: activeRuntime().expandedToolIds.size > 0,
				hasExpandedThinkingOverride: [
					...activeRuntime().thinkingExpansionOverrides.values(),
				].some(Boolean),
			});
			setExpandedTools(next);
			setAllThinkingExpanded(next);
			setCompactionExpanded(next);
			setExpandedToolIds(new Set<string>());
			return;
		}
		if (keyIs(event, "l", { ctrl: true, shift: true })) {
			event.preventDefault();
			event.stopPropagation();
			try {
				const archive = createDiagnosticBundle({
					logDirectory: ports.logger.directory,
				});
				const copied = renderer.copyToClipboardOSC52(archive);
				ports.logger.info("diagnostics.bundle_created", { archive });
				toast(
					`Diagnostics saved: ${archive}${copied ? " (path copied)" : ""}`,
					"success",
					7000,
				);
			} catch (error) {
				ports.logger.error("diagnostics.bundle_failed", error);
				toast(
					error instanceof Error ? error.message : String(error),
					"error",
					7000,
				);
			}
			return;
		}
		if (keyIs(event, "i", { ctrl: true })) {
			event.preventDefault();
			event.stopPropagation();
			const targets = displaySubagentTargets();
			const decision = subagentInspectDecision(
				inspectSubagent(),
				targets.length,
			);
			if (decision === "close") {
				closeSubagentInspector();
				return;
			}
			if (!subagentsAvailable())
				return toast(
					"Install a supported subagent runtime to inspect and steer child agents",
					"info",
					5000,
				);
			if (decision === "warning")
				return toast("No subagent selected", "warning");
			if (decision === "choose") {
				setSubagentSelectorOpen(true);
				return;
			}
			const target = targets[0];
			if (!target) return toast("No subagent selected", "warning");
			setSelectedTargetKey(target.key);
			setInspectSubagent(true);
			queueMicrotask(() =>
				subagentScroll?.scrollTo(inspectedTargetScrollY(target)),
			);
			return;
		}
		if (keyIs(event, "a", { ctrl: true, shift: false })) {
			if (!inspectSubagent()) return;
			event.preventDefault();
			requestPauseSubagent();
			return;
		}
		if (keyIs(event, "a", { ctrl: true, shift: true })) {
			if (!inspectSubagent()) return;
			event.preventDefault();
			requestStopSubagent();
			return;
		}
		if (event.name === "f6") {
			event.preventDefault();
			event.stopPropagation();
			cycleSubagent(event.shift ? -1 : 1);
			return;
		}
		if (event.name === "escape" && inspectSubagent()) {
			event.preventDefault();
			event.stopPropagation();
			closeSubagentInspector();
			return;
		}
		if (event.name === "escape" && streaming()) {
			event.preventDefault();
			event.stopPropagation();
			abortActiveWork();
		}
	});
}
