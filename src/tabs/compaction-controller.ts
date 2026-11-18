import type { DiagnosticLogger } from "../diagnostics/logger.ts";
import type { PiEvent, RpcExtensionUIRequest } from "../types.ts";
import type { ConversationTabRuntime } from "./runtime.ts";
import {
 COMPACTION_STATUS_KEY, ONE_ROUND_PROGRESS_KEY, ONE_ROUND_LEGACY_PROGRESS_KEY,
 SMART_COMPACT_PROGRESS_KEY, compactionCompletionFromResult, compactionSuccessText,
 isCompactionReason, parseCompactionTelemetry, parseOneRoundProgress,
 parseSmartCompactProgress, applyOneRoundLaneDeltas,
 type CompactionCompletion,
} from "../state/compaction-telemetry.ts";

/** Owns per-tab compaction progress and completion. UI only receives a change callback. */
export class CompactionController {
 private readonly invalidWarnings = new Set<string>();
 constructor(private readonly notify: (runtime: ConversationTabRuntime) => void,
             private readonly logger: DiagnosticLogger) {}

 private updateCompactionSystemItem(tabRuntime: ConversationTabRuntime, text: string): void {
		for (let index = tabRuntime.conversation.items.length - 1; index >= 0; index -= 1) {
			const item = tabRuntime.conversation.items[index];
			if (item?.kind === "system" && item.text.startsWith("Context compacted")) {
				tabRuntime.conversation.items[index] = { ...item, text };
				return;
			}
		}

 }

 handleStart(event: PiEvent, tabRuntime: ConversationTabRuntime): void {
		if (event.type === "compaction_start") {
			const usage = tabRuntime.sessionStats?.contextUsage;
			tabRuntime.compactionAttempt += 1;
			delete tabRuntime.lastCompactionCompletion;
			tabRuntime.compactionTelemetry = {
				version: 1,
				phase: "preparing",
				attempt: tabRuntime.compactionAttempt,
				...(isCompactionReason(event.reason) ? { reason: event.reason } : {}),
				...(typeof usage?.tokens === "number"
					? { tokensBefore: usage.tokens }
					: {}),
				...(typeof usage?.contextWindow === "number"
					? { contextWindow: usage.contextWindow }
					: {}),
				...(typeof usage?.percent === "number"
					? { contextPercent: usage.percent }
					: {}),
				startedAt: Date.now(),
			};
			this.notify(tabRuntime);
		}
 }

 /** Returns true for consumed compaction statuses; unrelated statuses are routed elsewhere. */
 handleStatus(event: RpcExtensionUIRequest, tabRuntime: ConversationTabRuntime): boolean {
			if (
				event.method === "setStatus" &&
				event.statusKey === SMART_COMPACT_PROGRESS_KEY
			) {
				const progress = parseSmartCompactProgress(event.statusText);
				if (progress === undefined) {
					if (tabRuntime.smartCompactProgress !== undefined) {
						delete tabRuntime.smartCompactProgress;
						this.notify(tabRuntime);
					}
				} else {
					tabRuntime.smartCompactProgress = progress;
					this.notify(tabRuntime);
				}
				return true;
			}
			if (
				event.method === "setStatus" &&
				(event.statusKey === ONE_ROUND_PROGRESS_KEY || event.statusKey === ONE_ROUND_LEGACY_PROGRESS_KEY)
			) {
				const progress =
					typeof event.statusText === "string"
						? parseOneRoundProgress(event.statusText)
						: undefined;
				if (progress === undefined) {
					if (
						tabRuntime.oneRoundProgress !== undefined ||
						tabRuntime.oneRoundLaneTexts !== undefined
					) {
						delete tabRuntime.oneRoundProgress;
						delete tabRuntime.oneRoundLaneTexts;
						this.notify(tabRuntime);
					}
				} else if (
					progress.phase === "complete" ||
					progress.phase === "error" ||
					progress.phase === "aborted"
				) {
					delete tabRuntime.oneRoundProgress;
					this.notify(tabRuntime);
				} else {
					tabRuntime.oneRoundLaneTexts = applyOneRoundLaneDeltas(
						tabRuntime.oneRoundLaneTexts,
						progress,
					);
					if (tabRuntime.oneRoundProgress !== progress) {
						tabRuntime.oneRoundProgress = progress;
						this.notify(tabRuntime);
					}
				}
				return true;
			}
			if (
				event.method === "setStatus" &&
				event.statusKey === COMPACTION_STATUS_KEY
			) {
				const telemetry =
					typeof event.statusText === "string"
						? parseCompactionTelemetry(event.statusText)
						: undefined;
				const current = tabRuntime.compactionTelemetry;
				const completion = tabRuntime.lastCompactionCompletion;
				if (
					telemetry &&
					telemetry.attempt !== undefined &&
					((current && telemetry.attempt !== current.attempt) ||
						(completion && telemetry.attempt !== completion.attempt))
				)
					return true;
				if (telemetry?.phase === "complete" && telemetry.attempt === undefined)
					return true;
				if (telemetry?.phase === "failed") {
					delete tabRuntime.compactionTelemetry;
					delete tabRuntime.lastCompactionCompletion;
					this.notify(tabRuntime);
				} else if (telemetry) {
					if (telemetry.phase === "complete" && !current && !completion)
						return true;
					if (current) {
						tabRuntime.compactionTelemetry = {
							...current,
							...telemetry,
							...(current.startedAt !== undefined
								? { startedAt: current.startedAt }
								: {}),
						};
					}
					if (telemetry.phase === "complete" && completion) {
						tabRuntime.lastCompactionCompletion = {
							...completion,
							...(telemetry.retainedContextMessages !== undefined
								? { retainedContextMessages: telemetry.retainedContextMessages }
								: {}),
						};
						this.updateCompactionSystemItem(
							tabRuntime,
							compactionSuccessText(tabRuntime.lastCompactionCompletion),
						);
					}
					this.notify(tabRuntime);
				} else if (!this.invalidWarnings.has(tabRuntime.id)) {
					this.invalidWarnings.add(tabRuntime.id);
					this.logger.warn("compaction.telemetry_invalid", {
						runtimeId: tabRuntime.id,
					});
				}
				return true;
			}

  return false;
 }

 handleEnd(event: PiEvent, tabRuntime: ConversationTabRuntime): void {
		if (event.type === "compaction_end") {
			const retained = tabRuntime.compactionTelemetry?.retainedContextMessages;
			delete tabRuntime.smartCompactProgress;
			delete tabRuntime.oneRoundProgress;
			delete tabRuntime.oneRoundLaneTexts;
			if (!event.aborted && !event.errorMessage) {
				const completion: CompactionCompletion = {
					...compactionCompletionFromResult(
						event.result,
						retained,
						tabRuntime.compactionTelemetry?.attempt,
					),
					...(tabRuntime.compactionTelemetry?.startedAt !== undefined
						? { durationMs: Date.now() - tabRuntime.compactionTelemetry.startedAt }
						: {}),
					...(isCompactionReason(event.reason) ? { reason: event.reason } : {}),
				};
				tabRuntime.lastCompactionCompletion = completion;
				this.updateCompactionSystemItem(tabRuntime, "Context compacted.");
			} else {
				delete tabRuntime.lastCompactionCompletion;
			}
			delete tabRuntime.compactionTelemetry;
			this.notify(tabRuntime);
		}
 }
}
