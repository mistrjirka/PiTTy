/** Transcript viewport, incremental history, and theme redraw position. */
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Accessor } from "solid-js";
import type { AppSignals } from "../state/app-signals.ts";
import {
	INITIAL_MESSAGE_WINDOW,
	initialMessageWindowStart,
	loadOlderMessageWindowStart,
	MAX_LIVE_MESSAGE_WINDOW,
	MESSAGE_LOAD_BATCH,
	trimMessageWindowStart,
} from "../ui/message-window.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import type { ThemeViewportSnapshot } from "./settings-mutations.ts";

export interface AppTranscriptScrollPorts {
	signals: AppSignals;
	getScroll: () => ScrollBoxRenderable | undefined;
	getSubagentScroll: () => ScrollBoxRenderable | undefined;
	dimensions: Accessor<{ width: number; height: number }>;
	inspectSubagent: () => boolean;
	activeRuntime: () => ConversationTabRuntime;
	activeTabId: Accessor<string>;
	isRuntimeActive: (id: string) => boolean;
}
export interface AppTranscriptScroll {
	updateScrollPosition: () => void;
	captureThemeViewport: () => ThemeViewportSnapshot;
	restoreThemeViewport: (snapshot: ThemeViewportSnapshot) => void;
	scrollToBottom: () => void;
	resetMessageWindow: (count?: number) => void;
	trimMessageWindowIfFollowingLatest: () => void;
	loadOlderMessages: () => void;
}

export function createAppTranscriptScroll(
	ports: AppTranscriptScrollPorts,
): AppTranscriptScroll {
	const { dimensions, inspectSubagent, activeRuntime, activeTabId } = ports;
	const tabRuntimeIsActive = ports.isRuntimeActive;
	const {
		showJumpLatest: [showJumpLatest, setShowJumpLatest],
		messageWindowStart: [messageWindowStart, setMessageWindowStart],
	} = ports.signals;
	const updateScrollPosition = () => {
		const scroll = ports.getScroll();
		if (!scroll || inspectSubagent()) {
			setShowJumpLatest(false);
			return;
		}
		const viewportHeight = Math.max(
			1,
			scroll.height || dimensions().height - 8,
		);
		const maxTop = Math.max(0, scroll.scrollHeight - viewportHeight);
		setShowJumpLatest(scroll.scrollTop < maxTop - 2);
	};

	const captureThemeViewport = (): ThemeViewportSnapshot => ({
		mainTop: ports.getScroll()?.scrollTop,
		subagentTop: ports.getSubagentScroll()?.scrollTop,
	});
	const restoreThemeViewport = (snapshot: ThemeViewportSnapshot) => {
		queueMicrotask(() =>
			queueMicrotask(() =>
				setTimeout(() => {
					if (snapshot.mainTop !== undefined)
						ports.getScroll()?.scrollTo({ x: 0, y: snapshot.mainTop });
					if (snapshot.subagentTop !== undefined)
						ports
							.getSubagentScroll()
							?.scrollTo({ x: 0, y: snapshot.subagentTop });
					updateScrollPosition();
				}, 0),
			),
		);
	};

	const scrollToBottom = () => {
		ports.getScroll()?.scrollTo({ x: 0, y: Number.MAX_SAFE_INTEGER });
		setShowJumpLatest(false);
	};

	const resetMessageWindow = (
		totalItems = activeRuntime().conversation.items.length,
	) => {
		setMessageWindowStart(
			initialMessageWindowStart(totalItems, INITIAL_MESSAGE_WINDOW),
		);
	};

	const trimMessageWindowIfFollowingLatest = () => {
		if (showJumpLatest() || inspectSubagent()) return;
		setMessageWindowStart((current) =>
			trimMessageWindowStart(
				activeRuntime().conversation.items.length,
				current,
				MAX_LIVE_MESSAGE_WINDOW,
			),
		);
	};

	const loadOlderMessages = () => {
		const capturedRuntime = activeRuntime();
		const capturedTabId = activeTabId();
		const current = messageWindowStart();
		if (current <= 0) return;
		const oldHeight = ports.getScroll()?.scrollHeight ?? 0;
		const oldTop = ports.getScroll()?.scrollTop ?? 0;
		setMessageWindowStart(
			loadOlderMessageWindowStart(current, MESSAGE_LOAD_BATCH),
		);
		// Keep the previously first visible message in place after prepending older
		// children. Two microtasks allow OpenTUI to finish the new layout first.
		queueMicrotask(() =>
			queueMicrotask(() => {
				if (
					!tabRuntimeIsActive(capturedTabId) ||
					activeRuntime() !== capturedRuntime
				)
					return;
				const scroll = ports.getScroll();
				if (!scroll) return;
				const addedHeight = Math.max(0, scroll.scrollHeight - oldHeight);
				scroll.scrollTo({ x: 0, y: oldTop + addedHeight });
				updateScrollPosition();
			}),
		);
	};

	return {
		updateScrollPosition,
		captureThemeViewport,
		restoreThemeViewport,
		scrollToBottom,
		resetMessageWindow,
		trimMessageWindowIfFollowingLatest,
		loadOlderMessages,
	};
}
