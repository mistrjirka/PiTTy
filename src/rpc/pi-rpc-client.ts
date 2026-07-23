import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	summarizePiArgs,
	type DiagnosticLogger,
} from "../diagnostics/logger.ts";
import { resolveDefaultPiExecutable, resolvePiCommand } from "../pi-command.ts";
import type {
	PiEvent,
	RpcCommand,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	SessionStats,
} from "../types.ts";

export type ThinkingLevel =
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export type PiRpcClientOptions = {
	cwd: string;
	executable?: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	requestTimeoutMs?: number;
	logger?: DiagnosticLogger;
};

type PendingRequest = {
	resolve: (response: RpcResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

export class PiRpcClient extends EventEmitter {
	private child: ChildProcessWithoutNullStreams | undefined;
	private readonly pending = new Map<string, PendingRequest>();
	private nextId = 0;
	private stdoutBuffer = "";
	private stderrBuffer = "";
	private stopping = false;
	private startupArgs: string[];

	constructor(private readonly options: PiRpcClientOptions) {
		super();
		this.startupArgs = [...(options.args ?? [])];
	}

	async start(): Promise<void> {
		if (this.child) throw new Error("Pi RPC client is already started.");
		this.stopping = false;
		this.stdoutBuffer = "";
		this.stderrBuffer = "";
		const configuredExecutable =
			this.options.executable ?? resolveDefaultPiExecutable();
		const piArgs = ["--mode", "rpc", ...this.startupArgs];
		const command = resolvePiCommand(configuredExecutable, piArgs);
		const executable = command.executable;
		const args = command.args;
		this.options.logger?.info("pi.spawn", {
			executable,
			args: summarizePiArgs(args),
			cwd: this.options.cwd,
		});
		const child = spawn(executable, args, {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		this.options.logger?.info("pi.spawned", { pid: child.pid });

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
		child.stderr.on("data", (chunk: string) => {
			this.stderrBuffer = (this.stderrBuffer + chunk).slice(-64_000);
			this.options.logger?.warn("pi.stderr", { chunk });
			this.emit("stderr", chunk);
		});
		child.on("error", (error) => {
			this.options.logger?.error("pi.process_error", error);
			this.failAll(new Error(`Failed to start Pi: ${error.message}`));
		});
		child.on("exit", (code, signal) => {
			const suffix = this.stderrBuffer.trim()
				? `\n${this.stderrBuffer.trim()}`
				: "";
			const error = new Error(
				`Pi RPC exited (code=${code ?? "null"}, signal=${signal ?? "none"}).${suffix}`,
			);
			this.options.logger?.error("pi.exit", {
				code,
				signal,
				stopping: this.stopping,
				stderrTail: this.stderrBuffer.slice(-8_000),
			});
			this.child = undefined;
			if (!this.stopping) this.emit("exit", error);
			this.failAll(error);
		});

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(resolve, 150);
			child.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.once("exit", (code, signal) => {
				clearTimeout(timer);
				reject(
					new Error(
						`Pi exited during startup (code=${code}, signal=${signal ?? "none"}).`,
					),
				);
			});
		});
	}

	async stop(): Promise<void> {
		const child = this.child;
		if (!child) return;
		this.stopping = true;
		this.options.logger?.info("pi.stop", { pid: child.pid });
		this.failAll(new Error("Pi RPC client stopped."));
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, 1_000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
		this.child = undefined;
	}

	/** Restart this client in the authoritative current session without replacing its event listeners. */
	async restart(sessionFile?: string): Promise<void> {
		const authoritativeSession =
			sessionFile ?? (await this.getState()).sessionFile;
		if (!authoritativeSession?.trim())
			throw new Error(
				"Cannot restart Pi RPC without an authoritative session file.",
			);
		await this.stop();
		const nextArgs: string[] = [];
		for (let index = 0; index < this.startupArgs.length; index += 1) {
			const argument = this.startupArgs[index];
			if (argument === undefined || argument === "--continue") continue;
			if (argument === "--session" || argument === "--session-id") {
				index += 1;
				continue;
			}
			nextArgs.push(argument);
		}
		this.startupArgs = [...nextArgs, "--session", authoritativeSession];
		await this.start();
	}

	onEvent(listener: (event: PiEvent) => void): () => void {
		this.on("event", listener);
		return () => this.off("event", listener);
	}

	getStderr(): string {
		return this.stderrBuffer;
	}

	async prompt(
		message: string,
		streamingBehavior?: "steer" | "followUp",
	): Promise<void> {
		await this.request({
			type: "prompt",
			message,
			...(streamingBehavior ? { streamingBehavior } : {}),
		});
	}

	async steer(message: string): Promise<void> {
		await this.request({ type: "steer", message });
	}

	async followUp(message: string): Promise<void> {
		await this.request({ type: "follow_up", message });
	}

	async abort(): Promise<void> {
		try {
			await this.request({ type: "abort" });
		} catch (error) {
			// Pi can finish aborting the active provider/tool before its RPC handler
			// gets a chance to acknowledge the command. Treat an acknowledgement
			// timeout as a successful best-effort abort instead of crashing the UI.
			if (
				error instanceof Error &&
				error.message === "Timed out waiting for Pi response to abort."
			) {
				this.options.logger?.warn("rpc.abort_ack_timeout");
				return;
			}
			throw error;
		}
	}

	async getState(): Promise<RpcSessionState> {
		return this.data(await this.request({ type: "get_state" }));
	}

	async getMessages(): Promise<unknown[]> {
		const data = this.data<{ messages: unknown[] }>(
			await this.request({ type: "get_messages" }),
		);
		return data.messages;
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
		Array<{ name: string; description?: string; source: string }>
	> {
		const data = this.data<{
			commands: Array<{ name: string; description?: string; source: string }>;
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
			if (
				error instanceof Error &&
				error.message === "Timed out waiting for Pi response to compact."
			) {
				this.options.logger?.warn("rpc.compact_ack_timeout");
				return undefined;
			}
			throw error;
		}
	}

	async newSession(): Promise<unknown> {
		return this.data(await this.request({ type: "new_session" }));
	}

	async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		return this.data<{ cancelled: boolean }>(
			await this.request({ type: "switch_session", sessionPath }),
		);
	}

	async sendExtensionUiResponse(
		response: RpcExtensionUIResponse,
	): Promise<void> {
		this.write(response);
	}

	private request(
		command: RpcCommand,
		timeoutMsOverride?: number,
	): Promise<RpcResponse> {
		if (!this.child?.stdin.writable)
			return Promise.reject(new Error("Pi RPC is not running."));
		const id = `ui_${++this.nextId}`;
		const request = { ...command, id };
		const startedAt = performance.now();
		this.options.logger?.rpc("tx", request);
		return new Promise<RpcResponse>((resolve, reject) => {
			const timeoutMs =
				timeoutMsOverride ?? this.options.requestTimeoutMs ?? 30_000;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.options.logger?.error("rpc.timeout", {
					id,
					command: command.type,
					timeoutMs,
				});
				reject(
					new Error(`Timed out waiting for Pi response to ${command.type}.`),
				);
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (response) => {
					this.options.logger?.rpc("rx", response, {
						durationMs: Math.round(performance.now() - startedAt),
						command: command.type,
					});
					resolve(response);
				},
				reject: (error) => {
					this.options.logger?.error("rpc.request_failed", {
						id,
						command: command.type,
						durationMs: Math.round(performance.now() - startedAt),
						error,
					});
					reject(error);
				},
				timer,
			});
			try {
				this.write(request);
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private write(value: object): void {
		const stdin = this.child?.stdin;
		if (!stdin?.writable) throw new Error("Pi RPC stdin is unavailable.");
		stdin.write(`${JSON.stringify(value)}\n`);
	}

	private consumeStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		while (true) {
			const newline = this.stdoutBuffer.indexOf("\n");
			if (newline < 0) break;
			const line = this.stdoutBuffer.slice(0, newline).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
			if (!line) continue;
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				const error = new Error(
					`Non-JSON Pi RPC output: ${line.slice(0, 300)}`,
				);
				this.options.logger?.error("rpc.protocol_error", {
					line: line.slice(0, 2_000),
				});
				this.emit("protocol-error", error);
				continue;
			}
			if (!value || typeof value !== "object") continue;
			const record = value as Record<string, unknown>;
			if (record.type === "response" && typeof record.id === "string") {
				const pending = this.pending.get(record.id);
				if (pending) {
					clearTimeout(pending.timer);
					this.pending.delete(record.id);
					pending.resolve(value as RpcResponse);
				} else {
					// The response for a request we already gave up on (e.g. a compact/prompt
					// ack that outran its client-side timeout). The real outcome still arrives
					// via independent events (compaction_end, message events, etc.), so just
					// log it instead of misrouting it through the generic event stream.
					this.options.logger?.warn("rpc.late_response", { id: record.id });
				}
				continue;
			}
			this.options.logger?.rpc("event", value);
			this.emit("event", value as PiEvent);
		}
	}

	private data<T>(response: RpcResponse): T {
		if (!response.success) throw new Error(response.error);
		return (response as RpcResponse & { data: T }).data;
	}

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}
