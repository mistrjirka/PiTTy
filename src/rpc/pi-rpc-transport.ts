import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
	type DiagnosticLogger,
	summarizePiArgs,
} from "../diagnostics/logger.ts";
import { resolveDefaultPiExecutable, resolvePiCommand } from "../pi-command.ts";
import { managedChildEnvironment, resolveForkCodeToolExtension } from "../pi-fork-runtime.ts";
import {
	locateDisplayRpcLoader,
	locateCodeToolForkLoader,
	locateManagedChildLauncher,
	resolveDisplayRpcLaunch,
} from "../pi-display/command.ts";
import type {
	PiEvent,
	RpcCommand,
	RpcResponse,
	RpcSessionState,
} from "../types.ts";

export type ThinkingLevel =
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export type PiRpcClientOptions = {
	cwd: string;
	executable?: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
	requestTimeoutMs?: number;
	logger?: DiagnosticLogger;
};

export class PiRpcTimeoutError extends Error {
	readonly command: string;
	readonly timeoutMs: number;

	constructor(command: string, timeoutMs: number) {
		super(`Timed out waiting for Pi response to ${command}.`);
		this.name = "PiRpcTimeoutError";
		this.command = command;
		this.timeoutMs = timeoutMs;
	}
}

type PendingRequest = {
	resolve: (response: RpcResponse) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
	commandType: string;
	timeoutMs: number;
	timeoutPaused: boolean;
};

export abstract class PiRpcTransport extends EventEmitter {
	abstract getState(timeoutMsOverride?: number): Promise<RpcSessionState>;
	private child: ChildProcessWithoutNullStreams | undefined;

	private readonly pending = new Map<string, PendingRequest>();

	private nextId = 0;

	private readonly stdoutFragments: string[] = [];

	protected displayRpcEnabled = false;

	private stderrBuffer = "";

	private stopping = false;
	private compacting = false;

	private startupArgs: string[];

	constructor(protected readonly options: PiRpcClientOptions) {
		super();
		this.startupArgs = [...(options.args ?? [])];
	}

	getProcessPid(): number | undefined {
		return this.child?.pid;
	}

	getClaudeConfigDir(): string | undefined {
		if (process.platform !== "linux" || !this.child?.pid)
			return (
				this.options.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR
			);
		try {
			const entry = readFileSync(`/proc/${this.child.pid}/environ`)
				.toString("utf8")
				.split("\0")
				.find((item) => item.startsWith("CLAUDE_CONFIG_DIR="));
			return entry?.slice("CLAUDE_CONFIG_DIR=".length);
		} catch {
			return (
				this.options.env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR
			);
		}
	}

	async start(): Promise<void> {
		if (this.child) throw new Error("Pi RPC client is already started.");
		this.stopping = false;
		this.compacting = false;
		this.stdoutFragments.length = 0;
		this.stderrBuffer = "";
		const configuredExecutable =
			this.options.executable ?? resolveDefaultPiExecutable();
		const piArgs = ["--mode", "rpc", ...this.startupArgs];
		const normalCommand = resolvePiCommand(configuredExecutable, piArgs);
		const loader = locateDisplayRpcLoader(import.meta.dir);
		const displayCommand = loader
			? resolveDisplayRpcLaunch(configuredExecutable, piArgs, loader, {
					...((this.options.env?.PATH ?? process.env.PATH)
						? { path: this.options.env?.PATH ?? process.env.PATH }
						: {}),
				})
			: undefined;
		const command = displayCommand ?? normalCommand;
		const executable = command.executable;
		const runtimeEnv = { ...process.env, ...this.options.env };
		const codeToolReplacement = resolveForkCodeToolExtension(
			configuredExecutable,
			runtimeEnv,
		);
		const codeToolLoader = codeToolReplacement
			? locateCodeToolForkLoader(import.meta.dir)
			: undefined;
		// Node preloads must precede the Pi JavaScript entrypoint.
		const args = codeToolLoader
			? [`--import=${codeToolLoader}`, ...command.args]
			: command.args;
		const childEnvironment = managedChildEnvironment(configuredExecutable, runtimeEnv, {
			node: executable,
			launcher: locateManagedChildLauncher(import.meta.dir, runtimeEnv.PITTY_APP_ROOT),
			displayLoader: displayCommand ? loader : undefined,
			codeLoader: codeToolLoader,
		});
		this.displayRpcEnabled = Boolean(displayCommand);
		if (displayCommand)
			this.options.logger?.info("rpc.display_adapter_enabled", {
				piVersion: displayCommand.piVersion,
			});
		this.options.logger?.info("pi.spawn", {
			executable,
			args: summarizePiArgs(args),
			cwd: this.options.cwd,
		});
		const child = spawn(executable, args, {
			cwd: this.options.cwd,
			env: {
				...process.env,
				...this.options.env,
				...childEnvironment,
				...(displayCommand?.environment ?? {}),
				...(codeToolLoader && codeToolReplacement
					? { PITTY_CODE_TOOL_REPLACEMENT: codeToolReplacement }
					: {}),
			},
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
			if (this.stopping) this.emit("stopped");
			else this.emit("exit", error);
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

	onEvent(listener: (event: PiEvent, receivedAt?: number) => void): () => void {
		this.on("event", listener);
		return () => this.off("event", listener);
	}

	getStderr(): string {
		return this.stderrBuffer;
	}

	protected request(
		command: RpcCommand | { type: "get_display_messages" },
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
				timeoutMsOverride ??
				this.options.requestTimeoutMs ??
				DEFAULT_REQUEST_TIMEOUT_MS;
			const pending: PendingRequest = {
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
				timer: undefined,
				commandType: command.type,
				timeoutMs,
				timeoutPaused: command.type === "prompt" && this.compacting,
			};
			this.pending.set(id, pending);
			if (!pending.timeoutPaused) pending.timer = this.startTimeout(id, pending);
			try {
				this.write(request);
			} catch (error) {
				if (pending.timer !== undefined) clearTimeout(pending.timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private startTimeout(
		id: string,
		pending: PendingRequest,
	): ReturnType<typeof setTimeout> {
		return setTimeout(() => {
			if (this.pending.get(id) !== pending) return;
			this.pending.delete(id);
			pending.timer = undefined;
			this.options.logger?.error("rpc.timeout", {
				id,
				command: pending.commandType,
				timeoutMs: pending.timeoutMs,
			});
			pending.reject(
				new PiRpcTimeoutError(pending.commandType, pending.timeoutMs),
			);
		}, pending.timeoutMs);
	}

	private pausePromptTimeouts(): void {
		for (const pending of this.pending.values()) {
			if (pending.commandType !== "prompt" || pending.timeoutPaused) continue;
			if (pending.timer !== undefined) clearTimeout(pending.timer);
			pending.timer = undefined;
			pending.timeoutPaused = true;
		}
	}

	private resumePromptTimeouts(): void {
		for (const [id, pending] of this.pending) {
			if (pending.commandType !== "prompt" || !pending.timeoutPaused) continue;
			pending.timeoutPaused = false;
			pending.timer = this.startTimeout(id, pending);
		}
	}

	protected write(value: Record<string, unknown>): void {
		const stdin = this.child?.stdin;
		if (!stdin?.writable) throw new Error("Pi RPC stdin is unavailable.");
		stdin.write(`${JSON.stringify(value)}\n`);
	}

	private consumeStdout(chunk: string): void {
		const receivedAt = Date.now();
		// A single tool result can be several MiB. Avoid repeatedly copying the
		// entire unfinished line whenever stdout delivers another small chunk.
		let start = 0;
		for (
			let newline = chunk.indexOf("\n", start);
			newline >= 0;
			newline = chunk.indexOf("\n", start)
		) {
			let line = chunk.slice(start, newline);
			if (this.stdoutFragments.length > 0) {
				this.stdoutFragments.push(line);
				line = this.stdoutFragments.join("");
				this.stdoutFragments.length = 0;
			}
			start = newline + 1;
			line = line.trim();
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
			if (record.type === "compaction_start") {
				this.compacting = true;
				this.pausePromptTimeouts();
			}
			if (record.type === "compaction_end") {
				this.compacting = false;
				this.resumePromptTimeouts();
			}
			this.options.logger?.rpc("event", value);
			this.emit("event", value as PiEvent, receivedAt);
		}
		if (start < chunk.length) this.stdoutFragments.push(chunk.slice(start));
	}

	protected data<T>(response: RpcResponse): T {
		if (!response.success) throw new Error(response.error);
		return (response as RpcResponse & { data: T }).data;
	}

	private failAll(error: Error): void {
		for (const pending of this.pending.values()) {
			if (pending.timer !== undefined) clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}
