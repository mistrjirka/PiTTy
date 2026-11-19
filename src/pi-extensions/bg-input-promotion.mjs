/**
 * Release pi-bg-bash's foreground wait after RPC input has entered Pi's queue.
 * The plugin retains the same process, log and task completion handling.
 */
const KEY = Symbol.for("pi-bg-bash.registry");

/** Return tasks adopted by this handoff, or none when the plugin is absent. */
export async function promoteForegroundCommands(registry, sessionId) {
	if (!registry || registry.ctx?.sessionManager?.getSessionId() !== sessionId ||
		!(registry.foreground instanceof Set) || !(registry.tasks instanceof Map)) return [];
	// These gates wait for launch only, never for command completion.
	if (registry.launching?.size) await Promise.all([...registry.launching]);
	if (registry.ctx?.sessionManager?.getSessionId() !== sessionId) return [];
	const before = new Set(registry.tasks.keys());
	for (const run of [...registry.foreground]) {
		if (typeof run.promote === "function") run.promote("shortcut");
	}
	return [...registry.tasks.values()].filter(
		(task) => !before.has(task.id) && task.ownerSessionId === sessionId,
	);
}

/** Manual plugin promotion clears its timer. Retain the original absolute limit. */
function preserveExecutionDeadline(task, input) {
	const timeout = input?.timeout;
	if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(task.startedAt)) return;
	const deadline = task.startedAt + timeout * 1000;
	if (!Number.isFinite(deadline)) return;
	// A waitFor promotion may already have a deadline. Never move it later.
	if (task.deadline === undefined || deadline < task.deadline) task.deadline = deadline;
}

export default function backgroundInputPromotion(pi) {
	const promoted = new Set();
	pi.on("input_queued", async (event, ctx) => {
		if (event.source !== "rpc") return;
		const tasks = await promoteForegroundCommands(
			globalThis[KEY], ctx.sessionManager.getSessionId(),
		);
		for (const task of tasks) promoted.add(task.id);
	});
	pi.on("tool_result", (event) => {
		if (event.toolName !== "bash" || !promoted.size) return;
		const registry = globalThis[KEY];
		const task = [...(registry?.tasks?.values() ?? [])].find(
			(entry) => entry.toolCallId === event.toolCallId && promoted.has(entry.id),
		);
		if (!task) return;
		preserveExecutionDeadline(task, event.input);
		promoted.delete(task.id);
		// The plugin calls every manual promotion a keyboard shortcut.
		// Preserve its output while reporting the actual reason for this handoff.
		let changed = false;
		const content = event.content.map((part) => {
			if (part.type !== "text") return part;
			const text = part.text.replace(
				/^The user pressed ctrl\+shift\+b after [\d.]+ s: /,
				"A new user message arrived: ",
			);
			if (text === part.text) return part;
			changed = true;
			return { ...part, text };
		});
		if (changed) return {
			content,
			// Pi drops structuredContent when a hook replaces only content.
			// Codemode callers still need the plugin's task_id and raw output.
			...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }),
		};
	});
	pi.on("session_shutdown", () => promoted.clear());
}
