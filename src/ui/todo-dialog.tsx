import { Show, type Accessor } from "solid-js";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors } from "./theme.ts";
import type { TodoViewItem } from "./todos.tsx";

export type TodoDialogProps = {
	todo: Accessor<TodoViewItem | undefined>;
	onClose: () => void;
};

function statusLabel(todo: TodoViewItem): string {
	if (todo.done) return "done";
	if (
		todo.status === "in_progress" ||
		todo.status === "running" ||
		todo.status === "active"
	)
		return "active";
	return todo.status.replace(/_/g, " ");
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

export function TodoDialog(props: TodoDialogProps) {
	return (
		<box
			position="absolute"
			left={0}
			right={0}
			top={0}
			bottom={0}
			onMouseDown={(event) => {
				event.stopPropagation();
			}}
		>
			<DialogFrame title="Todo detail" zIndex={160} onClose={props.onClose}>
				<Show
					when={props.todo()}
					fallback={<text fg={colors.muted}>Todo unavailable</text>}
				>
					{(todo) => (
						<box flexDirection="column" marginTop={1}>
							<text fg={colors.muted}>#{todo().id}</text>
							<text fg={statusColor(todo())} attributes={1}>
								{statusLabel(todo())}
							</text>
							<box height={1} />
							<text fg={colors.text} wrapMode="word">
								{todo().text}
							</text>
							<Show
								when={todo().activeForm && todo().activeForm !== todo().text}
							>
								<box height={1} />
								<text fg={colors.subtle} wrapMode="word">
									{todo().activeForm}
								</text>
							</Show>
						</box>
					)}
				</Show>
			</DialogFrame>
		</box>
	);
}
