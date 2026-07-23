import { For, Show } from "solid-js";
import stripAnsi from "strip-ansi";
import type { ConversationItem, ToolItem } from "../types.ts";
import { colors } from "./theme.ts";

export type TodoViewItem = {
	id: string;
	text: string;
	status: string;
	done: boolean;
	activeForm?: string | undefined;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function clean(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const result = stripAnsi(value)
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return result || undefined;
}

function firstString(
	source: Record<string, unknown> | undefined,
	names: string[],
): string | undefined {
	if (!source) return undefined;
	for (const name of names) {
		const value = clean(source[name]);
		if (value) return value;
	}
	return undefined;
}

function normalizeStatus(value: unknown, done?: boolean): string {
	const raw = clean(value)
		?.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (raw) return raw;
	return done ? "completed" : "pending";
}

function isDoneStatus(status: string): boolean {
	return [
		"completed",
		"complete",
		"done",
		"cancelled",
		"canceled",
		"closed",
		"skipped",
	].includes(status);
}

function parseTodo(
	raw: unknown,
	fallbackIndex: number,
): TodoViewItem | undefined {
	const source = record(raw);
	if (!source) return undefined;
	const rawId =
		source.id ??
		source.todoId ??
		source.todo_id ??
		source.taskId ??
		source.task_id ??
		fallbackIndex + 1;
	const id = String(rawId);
	const activeForm = firstString(source, [
		"activeForm",
		"active_form",
		"active",
		"currentForm",
	]);
	const text =
		firstString(source, [
			"text",
			"title",
			"task",
			"content",
			"description",
			"subject",
			"name",
		]) ?? activeForm;
	if (!text) return undefined;
	const explicitDone =
		typeof source.done === "boolean"
			? source.done
			: typeof source.completed === "boolean"
				? source.completed
				: undefined;
	const status = normalizeStatus(source.status ?? source.state, explicitDone);
	return {
		id,
		text,
		status,
		done: explicitDone ?? isDoneStatus(status),
		...(activeForm ? { activeForm } : {}),
	};
}

function authoritativeTodos(details: unknown): TodoViewItem[] | undefined {
	const source = record(details);
	const raw = source?.todos ?? source?.items ?? source?.tasks;
	if (!Array.isArray(raw)) return undefined;
	return raw.flatMap((value, index) => {
		const todo = parseTodo(value, index);
		return todo && todo.status !== "deleted" ? [todo] : [];
	});
}

function toolIsTodo(item: ToolItem): boolean {
	const name = item.name.toLowerCase().split(/[.:/]/).at(-1) ?? "";
	return name === "todo" || name === "todos";
}

function outputId(output: string): string | undefined {
	return output.match(/#([\w.-]+)/)?.[1];
}

function outputText(output: string): string | undefined {
	const cleanOutput = stripAnsi(output).replace(/\r/g, "").trim();
	const match = cleanOutput.match(
		/(?:created|added)(?:\s+todo|\s+task)?\s+#?[\w.-]+\s*:\s*(.+?)(?:\s+\((?:pending|in[_ -]?progress|completed|done)\))?(?:\n|$)/i,
	);
	return clean(match?.[1]);
}

function outputStatus(output: string): string | undefined {
	const cleanOutput = stripAnsi(output);
	const transition = cleanOutput.match(/(?:→|->)\s*([a-z][\w -]*)/i)?.[1];
	if (transition) return normalizeStatus(transition);
	const parenthesized = cleanOutput.match(
		/\((pending|in[_ -]?progress|completed|done|cancelled|canceled)\)/i,
	)?.[1];
	if (parenthesized) return normalizeStatus(parenthesized);
	if (/\bcompleted\b|\bdone\b/i.test(cleanOutput)) return "completed";
	return undefined;
}

function parseListedOutput(output: string): TodoViewItem[] {
	const result: TodoViewItem[] = [];
	for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
		const line = rawLine.trim();
		const match = line.match(
			/^(?:[-*]\s*)?(?:\[([ xX])\]|([✓✔○◌]))?\s*#([\w.-]+)\s*[:.-]?\s*(.+)$/,
		);
		if (!match) continue;
		const done =
			match[1]?.toLowerCase() === "x" || match[2] === "✓" || match[2] === "✔";
		const text = clean(match[4]);
		if (!text) continue;
		result.push({
			id: match[3]!,
			text,
			status: done ? "completed" : "pending",
			done,
		});
	}
	return result;
}

export function deriveTodos(
	items: readonly ConversationItem[],
): TodoViewItem[] {
	const map = new Map<string, TodoViewItem>();
	let sawTodoTool = false;

	for (const item of items) {
		if (item.kind !== "tool" || !toolIsTodo(item)) continue;
		sawTodoTool = true;

		const snapshot = authoritativeTodos(item.details);
		if (snapshot) {
			map.clear();
			for (const todo of snapshot) map.set(todo.id, todo);
			continue;
		}

		const args = record(item.args);
		const action =
			clean(args?.action)
				?.toLowerCase()
				.replace(/[\s-]+/g, "_") ?? "";
		if (action === "clear" || action === "clear_all" || action === "reset") {
			map.clear();
			continue;
		}

		const listed =
			action === "list" || action === "get"
				? parseListedOutput(item.output)
				: [];
		if (listed.length) {
			map.clear();
			for (const todo of listed) map.set(todo.id, todo);
			continue;
		}

		const rawId =
			args?.id ??
			args?.todoId ??
			args?.todo_id ??
			args?.taskId ??
			args?.task_id ??
			outputId(item.output);
		const id = rawId === undefined ? undefined : String(rawId);
		const text =
			firstString(args, [
				"text",
				"title",
				"task",
				"content",
				"description",
				"subject",
				"name",
			]) ?? outputText(item.output);
		const activeForm = firstString(args, [
			"activeForm",
			"active_form",
			"active",
			"currentForm",
		]);
		const status = normalizeStatus(
			args?.status ?? args?.state ?? outputStatus(item.output),
		);

		if (
			["add", "create", "new"].includes(action) &&
			id &&
			(text || activeForm)
		) {
			map.set(id, {
				id,
				text: text ?? activeForm!,
				status,
				done: isDoneStatus(status),
				...(activeForm ? { activeForm } : {}),
			});
			continue;
		}

		if (["delete", "remove"].includes(action) && id) {
			map.delete(id);
			continue;
		}

		if (
			["toggle", "update", "set", "set_status", "complete", "finish"].includes(
				action,
			) &&
			id
		) {
			const previous = map.get(id);
			const nextStatus =
				action === "complete" || action === "finish"
					? "completed"
					: action === "toggle" && previous
						? previous.done
							? "pending"
							: "completed"
						: status;
			map.set(id, {
				id,
				text: text ?? previous?.text ?? activeForm ?? `Todo #${id}`,
				status: nextStatus,
				done: isDoneStatus(nextStatus),
				...((activeForm ?? previous?.activeForm)
					? { activeForm: activeForm ?? previous?.activeForm }
					: {}),
			});
		}
	}

	if (!sawTodoTool) return [];
	return [...map.values()].sort((a, b) => {
		if (a.done !== b.done) return a.done ? 1 : -1;
		const aNum = Number(a.id);
		const bNum = Number(b.id);
		return Number.isFinite(aNum) && Number.isFinite(bNum)
			? aNum - bNum
			: a.id.localeCompare(b.id);
	});
}

function statusColor(todo: TodoViewItem): string {
	if (todo.done) return colors.subtle;
	if (
		todo.status === "in_progress" ||
		todo.status === "running" ||
		todo.status === "active"
	)
		return colors.green;
	if (todo.status === "blocked" || todo.status === "failed") return colors.red;
	return colors.yellow;
}

function statusIcon(todo: TodoViewItem): string {
	if (todo.done) return "✔";
	if (
		todo.status === "in_progress" ||
		todo.status === "running" ||
		todo.status === "active"
	)
		return "🟢";
	if (todo.status === "blocked" || todo.status === "failed") return "🔴";
	return "🟡";
}

function clip(value: string, width = 34): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= width
		? normalized
		: `${normalized.slice(0, width - 1)}…`;
}

function isRunning(todo: TodoViewItem): boolean {
	return (
		todo.status === "in_progress" ||
		todo.status === "running" ||
		todo.status === "active"
	);
}

export function TodoPanel(props: {
	todos: TodoViewItem[];
	height: number;
	onOpenTodo?: ((todo: TodoViewItem) => void) | undefined;
}) {
	const active = () => props.todos.filter((todo) => !todo.done);
	const done = () => props.todos.filter((todo) => todo.done);
	const running = () => active().filter(isRunning);
	const pending = () => active().filter((todo) => !isRunning(todo));
	return (
		<box
			flexDirection="column"
			minHeight={Math.min(6, props.height)}
			height={props.height}
			border={["top"]}
			borderColor={colors.borderStrong}
			paddingTop={1}
		>
			<box height={1} flexDirection="row">
				<text fg={colors.textBright} attributes={1}>
					Todos
				</text>
				<box flexGrow={1} />
				<text fg={colors.muted}>
					{pending().length} pending · {running().length} active ·{" "}
					{done().length} done
				</text>
			</box>
			<Show
				when={props.todos.length}
				fallback={<text fg={colors.muted}>No todo state found</text>}
			>
				<scrollbox
					flexGrow={1}
					minHeight={Math.min(3, Math.max(0, props.height - 2))}
					scrollY
					scrollX={false}
					viewportCulling={true}
					verticalScrollbarOptions={{
						showArrows: false,
						trackOptions: {
							foregroundColor: colors.borderStrong,
							backgroundColor: colors.background,
						},
					}}
					onMouseScroll={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					<For each={active()}>
						{(todo) => (
							<box
								height={1}
								minHeight={1}
								flexShrink={0}
								paddingLeft={1}
								border={["left"]}
								borderColor={statusColor(todo)}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onOpenTodo?.(todo);
								}}
							>
								<text height={1} fg={colors.text} wrapMode="none">
									{clip(
										`${statusIcon(todo)} #${todo.id} ${todo.activeForm ?? todo.text}`,
									)}
								</text>
							</box>
						)}
					</For>
					<Show when={done().length}>
						<box height={1} minHeight={1} marginTop={1}>
							<text fg={colors.subtle} attributes={1}>
								Done
							</text>
						</box>
					</Show>
					<For each={done()}>
						{(todo) => (
							<box
								height={1}
								minHeight={1}
								flexShrink={0}
								paddingLeft={1}
								border={["left"]}
								borderColor={colors.borderStrong}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onOpenTodo?.(todo);
								}}
							>
								<text height={1} fg={colors.subtle} wrapMode="none">
									{clip(`${statusIcon(todo)} #${todo.id} ${todo.text}`)}
								</text>
							</box>
						)}
					</For>
				</scrollbox>
			</Show>
		</box>
	);
}
