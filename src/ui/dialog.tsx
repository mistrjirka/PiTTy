import type { TextareaRenderable } from "@opentui/core";
import { Show, createMemo } from "solid-js";
import type { RpcExtensionUIRequest } from "../types.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors } from "./theme.ts";

export function ExtensionDialog(props: {
	request: RpcExtensionUIRequest;
	onValue: (value: string) => void;
	onConfirm: (value: boolean) => void;
	onCancel: () => void;
}) {
	let editor: TextareaRenderable | undefined;
	const title = createMemo(() =>
		"title" in props.request ? props.request.title : "Pi extension",
	);
	const options = createMemo(() =>
		props.request.method === "select"
			? props.request.options.map((name) => ({
					name,
					description: "",
					value: name,
				}))
			: [],
	);
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
			<DialogFrame title={title()} zIndex={100} onClose={props.onCancel}>
				<Show when={props.request.method === "confirm"}>
					<text fg={colors.text} wrapMode="word">
						{props.request.method === "confirm" ? props.request.message : ""}
					</text>
				</Show>
				<Show when={props.request.method === "select"}>
					<select
						options={options()}
						focused
						height={Math.min(12, Math.max(3, options().length))}
						backgroundColor={colors.panelRaised}
						textColor={colors.text}
						selectedBackgroundColor={colors.selection}
						selectedTextColor={colors.textBright}
						onSelect={(_index, option) =>
							option && props.onValue(String(option.value ?? option.name))
						}
					/>
				</Show>
				<Show
					when={
						props.request.method === "input" ||
						props.request.method === "editor"
					}
				>
					<textarea
						ref={(value) => {
							editor = value;
						}}
						focused
						initialValue={
							props.request.method === "editor"
								? (props.request.prefill ?? "")
								: ""
						}
						placeholder={
							props.request.method === "input"
								? (props.request.placeholder ?? "")
								: ""
						}
						minHeight={props.request.method === "editor" ? 8 : 3}
						maxHeight={18}
						wrapMode="word"
						backgroundColor={colors.panel}
						focusedBackgroundColor={colors.panel}
						textColor={colors.text}
						focusedTextColor={colors.text}
						selectionBg={colors.selection}
						onSubmit={() => props.onValue(editor?.plainText ?? "")}
					/>
				</Show>
				<Show when={props.request.method === "confirm"}>
					<box flexDirection="row" gap={2} marginTop={1}>
						<text fg={colors.green}>enter confirm</text>
						<text fg={colors.subtle}>esc cancel</text>
					</box>
				</Show>
			</DialogFrame>
		</box>
	);
}
