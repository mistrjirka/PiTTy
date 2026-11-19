/** Typed Pi RPC command API built on the process and framing transport. */

import type { ThinkingLevel } from "./pi-rpc-transport.ts";
import { PiRpcTimeoutError, PiRpcTransport } from "./pi-rpc-transport.ts";

export type { PiRpcClientOptions, ThinkingLevel } from "./pi-rpc-transport.ts";
export {
	DEFAULT_REQUEST_TIMEOUT_MS,
	PiRpcTimeoutError,
} from "./pi-rpc-transport.ts";

import { parseQueueState, type QueueState } from "./queue-types.ts";

import type {
	CloneResult,
	ForkMessage,
	ForkResult,
	RpcEntriesOptions,
	RpcExtensionUIResponse,
	RpcSessionState,
	SessionEntries,
	SessionStats,
	SessionSwitchResult,
} from "../types.ts";

export class PiRpcClient extends PiRpcTransport {
	async prompt(
		message: string,
		streamingBehavior?: "steer" | "followUp",
		messageId?: string,
	): Promise<void> {
		this.data(await this.request({
			type: "prompt",
			message,
			...(streamingBehavior ? { streamingBehavior } : {}),
			...(messageId ? { messageId } : {}),
		}));
	}

	async steer(message: string, messageId?: string): Promise<void> {
		this.data(await this.request({ type: "steer", message, ...(messageId ? { messageId } : {}) }));
	}

	async followUp(message: string, messageId?: string): Promise<void> {
		this.data(await this.request({ type: "follow_up", message, ...(messageId ? { messageId } : {}) }));
	}

	private queueData(value: unknown): QueueState {
		const state = parseQueueState(value);
		if (!state) throw new Error("Pi returned invalid pending-message data.");
		return state;
	}

	async getQueue(): Promise<QueueState> {
		return this.queueData(this.data(await this.request({ type: "get_queue" })));
	}

	async updateQueuedMessage(messageId: string, message: string, expectedRevision?: number): Promise<QueueState> {
		return this.queueData(this.data(await this.request({
			type: "update_queued_message", messageId, message,
			...(expectedRevision !== undefined ? { expectedRevision } : {}),
		})));
	}

	async removeQueuedMessage(messageId: string, expectedRevision?: number): Promise<QueueState> {
		return this.queueData(this.data(await this.request({
			type: "remove_queued_message", messageId,
			...(expectedRevision !== undefined ? { expectedRevision } : {}),
		})));
	}

	async combineQueuedMessages(messageIds: string[], expectedRevision?: number): Promise<QueueState> {
		return this.queueData(this.data(await this.request({
			type: "combine_queued_messages", messageIds,
			...(expectedRevision !== undefined ? { expectedRevision } : {}),
		})));
	}

	async abort(): Promise<void> {
		try {
			await this.request({ type: "abort" });
		} catch (error) {
			// Pi can finish aborting the active provider/tool before its RPC handler
			// gets a chance to acknowledge the command. Treat an acknowledgement
			// timeout as a successful best-effort abort instead of crashing the UI.
			if (error instanceof PiRpcTimeoutError && error.command === "abort") {
				this.options.logger?.warn("rpc.abort_ack_timeout");
				return;
			}
			throw error;
		}
	}

	async getState(timeoutMsOverride?: number): Promise<RpcSessionState> {
		return this.data(
			await this.request({ type: "get_state" }, timeoutMsOverride),
		);
	}

	async getMessages(timeoutMsOverride?: number): Promise<unknown[]> {
		if (this.displayRpcEnabled) {
			const response = await this.request(
				{ type: "get_display_messages" },
				timeoutMsOverride,
			);
			if (response.success)
				return this.data<{ messages: unknown[] }>(response).messages;
			// An upgraded Pi can change internal RPC handler layout. The loader
			// intentionally avoids patching unsupported versions. Fall back only
			// for the missing optional command, not other RPC failures.
			if (
				!/unknown command|unsupported command|unrecognized command/i.test(
					response.error ?? "",
				)
			)
				return this.data<{ messages: unknown[] }>(response).messages;
			this.displayRpcEnabled = false;
			this.options.logger?.warn("rpc.display_adapter_fallback", {
				error: response.error,
			});
		}
		return this.data<{ messages: unknown[] }>(
			await this.request({ type: "get_messages" }, timeoutMsOverride),
		).messages;
	}

	async getSessionStats(): Promise<SessionStats> {
		return this.data(await this.request({ type: "get_session_stats" }));
	}

	async cycleModel(): Promise<unknown> {
		return this.data(await this.request({ type: "cycle_model" }));
	}

	async cycleThinkingLevel(): Promise<{ level?: string } | null> {
		return this.data<{ level?: string } | null>(
			await this.request({ type: "cycle_thinking_level" }),
		);
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		this.data(await this.request({ type: "set_thinking_level", level }));
	}

	async getAvailableModels(): Promise<unknown[]> {
		const data = this.data<{ models: unknown[] }>(
			await this.request({ type: "get_available_models" }),
		);
		return data.models;
	}

	async setModel(provider: string, modelId: string): Promise<unknown> {
		return this.data(
			await this.request({ type: "set_model", provider, modelId }),
		);
	}

	async setAutoCompaction(enabled: boolean): Promise<void> {
		await this.request({ type: "set_auto_compaction", enabled });
	}

	async setAutoRetry(enabled: boolean): Promise<void> {
		await this.request({ type: "set_auto_retry", enabled });
	}

	async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.request({ type: "set_steering_mode", mode });
	}

	async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
		await this.request({ type: "set_follow_up_mode", mode });
	}

	async setSessionName(name: string): Promise<void> {
		this.data(await this.request({ type: "set_session_name", name }));
	}

	async getCommands(): Promise<
		Array<{
			name: string;
			description?: string;
			source: string;
			location?: unknown;
			path?: unknown;
		}>
	> {
		const data = this.data<{
			commands: Array<{
				name: string;
				description?: string;
				source: string;
				location?: unknown;
				path?: unknown;
			}>;
		}>(await this.request({ type: "get_commands" }));
		return data.commands;
	}

	async compact(customInstructions?: string): Promise<unknown> {
		// Compaction summarizes the whole conversation and can legitimately take
		// several minutes on large sessions, well beyond the default request
		// timeout used for quick commands. Pi also streams compaction_start/
		// compaction_end events independently of this request-response pair, so
		// if our own client-side timer fires first that's just an unusually slow
		// compaction still running in the background, not a real failure - the
		// compaction_end event will still arrive and report the true outcome.
		try {
			return this.data(
				await this.request(
					{
						type: "compact",
						...(customInstructions ? { customInstructions } : {}),
					},
					10 * 60_000,
				),
			);
		} catch (error) {
			if (error instanceof PiRpcTimeoutError && error.command === "compact") {
				this.options.logger?.warn("rpc.compact_ack_timeout");
				return undefined;
			}
			throw error;
		}
	}

	async newSession(timeoutMsOverride = 240_000): Promise<unknown> {
		return this.data(
			await this.request({ type: "new_session" }, timeoutMsOverride),
		);
	}

	async switchSession(
		sessionPath: string,
		timeoutMsOverride = 240_000,
	): Promise<SessionSwitchResult> {
		return this.data<SessionSwitchResult>(
			await this.request(
				{ type: "switch_session", sessionPath },
				timeoutMsOverride,
			),
		);
	}

	async fork(
		entryId: string,
		timeoutMsOverride = 240_000,
	): Promise<ForkResult> {
		return this.data<ForkResult>(
			await this.request({ type: "fork", entryId }, timeoutMsOverride),
		);
	}

	async clone(timeoutMsOverride = 240_000): Promise<CloneResult> {
		return this.data<CloneResult>(
			await this.request({ type: "clone" }, timeoutMsOverride),
		);
	}

	async getForkMessages(timeoutMsOverride?: number): Promise<ForkMessage[]> {
		const data = this.data<{ messages: ForkMessage[] }>(
			await this.request({ type: "get_fork_messages" }, timeoutMsOverride),
		);
		return data.messages;
	}

	async getEntries(
		options?: RpcEntriesOptions,
		timeoutMsOverride?: number,
	): Promise<SessionEntries> {
		const data = this.data<SessionEntries>(
			await this.request(
				{
					type: "get_entries",
					...(options?.since ? { since: options.since } : {}),
				},
				timeoutMsOverride,
			),
		);
		return data;
	}

	async sendExtensionUiResponse(
		response: RpcExtensionUIResponse,
	): Promise<void> {
		this.write(response);
	}
}
