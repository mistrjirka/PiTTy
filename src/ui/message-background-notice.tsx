/**
 * Transcript rows for messages that extensions send on their own: a finished
 * pi-bg-bash job, and a quiet fallback for any other custom message. Both use
 * the tool-row shape (glyph, name, summary, time) instead of a raw text dump.
 */
import { For, Show } from "solid-js";
import type { CustomItem } from "../types.ts";
import { cleanTerminalText, customDetailsRecord } from "./message-format.tsx";
import { colors } from "./theme.ts";

/** Body lines shown under a notice; the rest are counted, not printed. */
export const NOTICE_PREVIEW_LINES = 3;

export type BackgroundCompletion = {
	taskId: string;
	/** `exited (code 0)`, `killed`, … as pi-bg-bash words it. */
	state: string;
	ok: boolean;
	runtime: string;
	command: string;
	output: string[];
};

const FINISHED = /^Background task (\S+) finished: (.+), ran (.+)\.$/;

/**
 * pi-bg-bash's completion text: a `finished` line, a `Command:` line, then
 * `Last output…:` and the tail, or `(no output)`. Anything else returns
 * undefined so the caller falls back to the generic row.
 */
export function parseBackgroundCompletion(
	text: string,
	exitCode: number | undefined,
): BackgroundCompletion | undefined {
	const lines = cleanTerminalText(text).split(/\r?\n/);
	const finished = FINISHED.exec(lines[0]?.trim() ?? "");
	if (!finished) return undefined;
	const command = lines[1]?.startsWith("Command: ") ? lines[1].slice("Command: ".length) : "";
	const outputStart = lines.findIndex((line, index) => index > 1 && line.startsWith("Last output"));
	const output =
		outputStart === -1
			? []
			: lines.slice(outputStart + 1).filter((line) => line.trim() && !line.startsWith("Watch: "));
	const state = finished[2] ?? "";
	return {
		taskId: finished[1] ?? "",
		state,
		ok: exitCode === undefined ? /\(code 0\)/.test(state) : exitCode === 0,
		runtime: finished[3] ?? "",
		command,
		output,
	};
}

function NoticeBody(props: { lines: readonly string[] }) {
	const shown = () => props.lines.slice(-NOTICE_PREVIEW_LINES);
	const hidden = () => props.lines.length - shown().length;
	return (
		<box flexDirection="column" paddingLeft={2}>
			<Show when={hidden() > 0}>
				<text fg={colors.subtle} wrapMode="none">{`+${hidden()} lines`}</text>
			</Show>
			<For each={shown()}>
				{(line) => (
					<text fg={colors.muted} selectable wrapMode="none">
						{line}
					</text>
				)}
			</For>
		</box>
	);
}

export function BackgroundCompletionRow(props: { item: CustomItem; completion: BackgroundCompletion }) {
	const completion = () => props.completion;
	return (
		<box id={props.item.id} flexDirection="column" paddingLeft={1} paddingRight={1} marginBottom={1}>
			<box flexDirection="row" height={1}>
				<text fg={completion().ok ? colors.green : colors.red} wrapMode="none" flexShrink={0}>
					{completion().ok ? "✓ " : "✗ "}
				</text>
				<text fg={colors.orange} attributes={1} wrapMode="none" flexShrink={0}>
					{completion().taskId}
				</text>
				<text fg={colors.text} selectable wrapMode="none" flexShrink={1} minWidth={0}>
					{`  ${completion().command}`}
				</text>
				<box flexGrow={1} minWidth={2} />
				<Show when={!completion().ok}>
					<text fg={colors.red} wrapMode="none" flexShrink={0}>
						{`${completion().state}  `}
					</text>
				</Show>
				<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
					{completion().runtime}
				</text>
			</box>
			<Show
				when={completion().output.length > 0}
				fallback={
					<text fg={colors.subtle} paddingLeft={2}>
						no output
					</text>
				}
			>
				<NoticeBody lines={completion().output} />
			</Show>
		</box>
	);
}

/** Any other extension message: source name, first line, a short tail. */
export function GenericNoticeRow(props: { item: CustomItem }) {
	const lines = () =>
		cleanTerminalText(props.item.text)
			.split(/\r?\n/)
			.filter((line) => line.trim());
	return (
		<box id={props.item.id} flexDirection="column" paddingLeft={1} paddingRight={1} marginBottom={1}>
			<box flexDirection="row" height={1}>
				<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
					{"· "}
				</text>
				<text fg={colors.muted} attributes={1} wrapMode="none" flexShrink={0}>
					{props.item.customType}
				</text>
				<text fg={colors.text} selectable wrapMode="none" flexShrink={1} minWidth={0}>
					{`  ${lines()[0] ?? ""}`}
				</text>
			</box>
			<Show when={lines().length > 1}>
				<NoticeBody lines={lines().slice(1)} />
			</Show>
		</box>
	);
}

export function backgroundCompletionFor(item: CustomItem): BackgroundCompletion | undefined {
	if (item.customType !== "pi-bg-bash") return undefined;
	const exitCode = customDetailsRecord(item)?.exitCode;
	return parseBackgroundCompletion(
		item.text,
		typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : undefined,
	);
}
