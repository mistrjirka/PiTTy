import type { TextareaRenderable } from "@opentui/core";
import { Show, createMemo } from "solid-js";
import type { RpcExtensionUIRequest } from "../types.ts";
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
			<box
				position="absolute"
				left="15%"
				right="15%"
				top="20%"
				maxHeight="60%"
				flexDirection="column"
				backgroundColor={colors.panelRaised}
				border
				borderColor={colors.borderStrong}
				padding={1}
				zIndex={100}
				onMouseDown={(event) => {
					event.stopPropagation();
				}}
			>
				<text fg={colors.textBright} attributes={1}>
					{title()}
				</text>
				<Show when={props.request.method === "confirm"}>
					<text fg={colors.text} wrapMode="word">
						{props.request.method === "confirm" ? props.request.message : ""}
					</text>
					<text fg={colors.muted}>Enter confirm · Esc cancel · ←/→ choose</text>
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
						<text fg={colors.green}>[Enter] Confirm</text>
						<text fg={colors.red}>[Esc] Cancel</text>
					</box>
				</Show>
			</box>
		</box>
	);
}
