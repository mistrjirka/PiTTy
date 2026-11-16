/**
 * Read-only bridge for pi-bg-bash's process-local task registry.
 * It uses Pi's UI status channel. It does not change tool schemas,
 * append messages to the model context, or read command output.
 */
export const STATUS_KEY = "pitty.bg.v1";
const KEY = Symbol.for("pi-bg-bash.registry");
const MAX_TASKS = 100;
const MAX_COMMAND_CHARS = 32_768;

export function snapshotBackgroundTasks(registry, sessionId) {
	if (!registry?.tasks || typeof sessionId !== "string") return [];
	const rows = Array.from(registry.tasks.values())
		.filter((task) => task?.ownerSessionId === sessionId && /^bg-[1-9]\d*$/.test(task.id ?? ""))
		.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
		.slice(0, MAX_TASKS)
		.map((task) => ({
			id: task.id,
			command: String(task.command ?? "").slice(0, MAX_COMMAND_CHARS),
			commandTruncated: String(task.command ?? "").length > MAX_COMMAND_CHARS,
			cwd: String(task.cwd ?? "").slice(0, 4096),
			state: task.state,
			startedAt: task.startedAt,
			...(task.endedAt === undefined ? {} : { endedAt: task.endedAt }),
			...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
			...(task.reason === undefined ? {} : { reason: task.reason }),
		}));
	return rows;
}

export default function backgroundObserver(pi) {
	let ctx;
	let sessionId;
	let timer;
	let previous = "";

	const publish = () => {
		if (!ctx || !sessionId) return;
		const registry = globalThis[KEY];
		const tasks = snapshotBackgroundTasks(registry, sessionId);
		// Nothing installed/running and nothing to clear.
		if (!tasks.length && !previous) return;
		const next = JSON.stringify({ version: 1, sessionId, tasks });
		if (next === previous) return;
		previous = next;
		try {
			ctx.ui.setStatus(STATUS_KEY, next);
		} catch {
			// UI observer must never block a tool, model request, or compaction.
		}
	};
	pi.on("session_start", (_event, context) => {
		ctx = context;
		sessionId = context.sessionManager.getSessionId();
		previous = "";
		if (timer) clearInterval(timer);
		publish();
		timer = setInterval(publish, 1_000);
		timer.unref?.();
	});
	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
		ctx = undefined;
		sessionId = undefined;
		previous = "";
	});
}
