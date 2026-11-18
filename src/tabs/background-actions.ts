/** Background command output pager and analysis action. */
import { type Accessor, createEffect, type Setter } from "solid-js";
import {
	type BackgroundOutputPage,
	type BackgroundTask,
	type BackgroundTaskSelection,
	readBackgroundOutput,
} from "../state/background-tasks.ts";
import type { Toast } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";

export interface BackgroundActionsPorts {
	readonly activeRuntime: () => ConversationTabRuntime;
	readonly activeTabId: Accessor<string>;
	readonly revision: Accessor<number>;
	readonly backgroundSelection: Accessor<BackgroundTaskSelection | undefined>;
	readonly setBackgroundSelection: Setter<BackgroundTaskSelection | undefined>;
	readonly backgroundOutput: Accessor<BackgroundOutputPage | undefined>;
	readonly setBackgroundOutput: Setter<BackgroundOutputPage | undefined>;
	readonly setBackgroundOutputError: Setter<string | undefined>;
	readonly setBackgroundOutputBusy: Setter<boolean>;
	readonly backgroundOutputBusy: Accessor<boolean>;
	readonly clockNow: Accessor<number>;
	readonly focusMainPrompt: () => void;
	readonly sendText: (text: string) => Promise<"sent" | "queued">;
	readonly toast: (
		text: string,
		tone: Toast["tone"],
		durationMs?: number,
	) => void;
}

export interface BackgroundActions {
	backgroundTasks: () => BackgroundTask[];
	selectedBackgroundTask: () => BackgroundTask | undefined;
	showBackgroundOutputPage: (page: number) => Promise<void>;
	openBackgroundTask: (id: string) => void;
	closeBackgroundTask: () => void;
	analyzeBackgroundTask: () => void;
}

export function createBackgroundActions(
	ports: BackgroundActionsPorts,
): BackgroundActions {
	let outputRequest = 0;
	let lastPoll = 0;
	const backgroundTasks = () => {
		ports.revision();
		return ports.activeRuntime().background?.tasks ?? [];
	};
	const selectedBackgroundTask = () => {
		const selection = ports.backgroundSelection();
		if (!selection || selection.runtimeId !== ports.activeTabId())
			return undefined;
		return backgroundTasks().find((task) => task.id === selection.id);
	};
	const showBackgroundOutputPage = async (page: number) => {
		const selection = ports.backgroundSelection();
		if (!selection) return;
		const request = ++outputRequest;
		ports.setBackgroundOutputBusy(true);
		ports.setBackgroundOutputError(undefined);
		try {
			const output = await readBackgroundOutput(
				selection.sessionId,
				selection.id,
				page,
			);
			if (
				request === outputRequest &&
				ports.backgroundSelection() === selection
			) {
				ports.setBackgroundOutput((previous) =>
					previous?.page === output.page &&
					previous.totalBytes === output.totalBytes &&
					previous.text === output.text &&
					previous.available === output.available
						? previous
						: output,
				);
			}
		} catch (error) {
			if (request === outputRequest)
				ports.setBackgroundOutputError(
					error instanceof Error ? error.message : String(error),
				);
		} finally {
			if (request === outputRequest) ports.setBackgroundOutputBusy(false);
		}
	};
	const openBackgroundTask = (id: string) => {
		const snapshot = ports.activeRuntime().background;
		if (!snapshot?.tasks.some((task) => task.id === id)) return;
		outputRequest++;
		ports.setBackgroundOutput(undefined);
		ports.setBackgroundOutputError(undefined);
		ports.setBackgroundSelection({
			runtimeId: ports.activeTabId(),
			sessionId: snapshot.sessionId,
			id,
		});
		lastPoll = Date.now();
		void showBackgroundOutputPage(0);
	};
	const closeBackgroundTask = () => {
		outputRequest++;
		ports.setBackgroundSelection(undefined);
		ports.setBackgroundOutput(undefined);
		ports.setBackgroundOutputError(undefined);
		queueMicrotask(ports.focusMainPrompt);
	};
	const analyzeBackgroundTask = () => {
		const task = selectedBackgroundTask();
		const output = ports.backgroundOutput();
		if (!task) return;
		const context = [
			"Analyze this background command and its observed output. Identify any problems and suggest fixes. Do not modify files or run commands unless requested.",
			`Working directory: ${task.cwd}`,
			`Command (${task.commandTruncated ? "observer excerpt, original longer" : "original"}):\n${task.command}`,
			`Status: ${task.state}${task.exitCode === undefined ? "" : ` (exit ${task.exitCode})`}`,
			`Output (${output ? `bytes ${output.startByte}-${output.endByte} of ${output.totalBytes}` : "not available"}):\n${output?.text.slice(-12000) ?? ""}`,
		].join("\n\n");
		closeBackgroundTask();
		void ports
			.sendText(context)
			.catch((error) =>
				ports.toast(
					`Unable to submit analysis: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				),
			);
	};
	// Refresh the opened log only. Never run filesystem reads on model/tool turns.
	createEffect(() => {
		const selection = ports.backgroundSelection();
		const task = selectedBackgroundTask();
		const now = ports.clockNow();
		if (
			!selection ||
			task?.state !== "running" ||
			ports.backgroundOutput()?.page !== 0
		)
			return;
		if (now - lastPoll < 1_800 || ports.backgroundOutputBusy()) return;
		lastPoll = now;
		void showBackgroundOutputPage(0);
	});

	return {
		backgroundTasks,
		selectedBackgroundTask,
		showBackgroundOutputPage,
		openBackgroundTask,
		closeBackgroundTask,
		analyzeBackgroundTask,
	};
}
