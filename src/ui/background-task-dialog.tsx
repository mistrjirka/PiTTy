import { Show, type Accessor } from "solid-js";
import { backgroundStatus, type BackgroundOutputPage, type BackgroundTask } from "../state/background-tasks.ts";
import { DialogFrame } from "./dialog-frame.tsx";
import { colors } from "./theme.ts";
import { backgroundTaskDuration } from "./background-task-duration.ts";

export function BackgroundTaskDialog(props: {
	task: Accessor<BackgroundTask | undefined>;
	output: Accessor<BackgroundOutputPage | undefined>;
	busy: boolean;
	now?: number | undefined;
	error?: string | undefined;
	onPage: (page: number) => void;
	onAnalyze: () => void;
	onClose: () => void;
}) {
	const page = () => props.output();
	const task = () => props.task();
	const duration = () => { const item = task(); return item ? backgroundTaskDuration(item, props.now ?? Date.now()) : undefined; };
	const commandHeading = () => task()?.commandTruncated
		? "Original command (observer excerpt, long command)"
		: "Original command";
	return (
		<box
			position="absolute"
			left={0}
			right={0}
			top={0}
			bottom={0}
			onMouseDown={(event) => event.stopPropagation()}
		>
			<DialogFrame
				id="background-detail"
				title={`Background ${task()?.id ?? "task"}`}
				summary={`${task() ? backgroundStatus(task()!) : "unavailable"}${duration() ? ` · ${duration()}` : ""}`}
				width="wide"
				height="tall"
				zIndex={170}
				onClose={props.onClose}
			>
				<text height={1} fg={colors.subtle} wrapMode="none">
					{task()?.cwd ?? ""}
				</text>
				<text height={1} fg={colors.textBright} attributes={1}>
					{commandHeading()}
				</text>
				<scrollbox id="background-command-scroll" height={Math.min(6, Math.max(2, Math.ceil((task()?.command.length ?? 0) / 100)))} minHeight={2} scrollY scrollX={false}>
					<text fg={colors.text} wrapMode="word" selectable>{task()?.command ?? ""}</text>
				</scrollbox>
				<box flexDirection="row" height={1} flexShrink={0} border={["top"]} borderColor={colors.borderStrong}>
					<text fg={colors.textBright} attributes={1}>Output</text>
					<box flexGrow={1} />
					<text fg={colors.subtle} wrapMode="none">
						{page() ? `${page()!.startByte.toLocaleString()}–${page()!.endByte.toLocaleString()} / ${page()!.totalBytes.toLocaleString()} bytes` : ""}
					</text>
				</box>
				<scrollbox
					id="background-output-scroll"
					paddingTop={1}
					flexGrow={1}
					minHeight={3}
					scrollY
					scrollX={false}
					viewportCulling
					verticalScrollbarOptions={{
						showArrows: false,
						trackOptions: {
							foregroundColor: colors.borderStrong,
							backgroundColor: colors.background,
						},
					}}
				>
					<text fg={colors.text} wrapMode="word" selectable>
						{props.error ?? (props.busy && !page() ? "Reading task output…" : !page()?.available ? "Output log not available yet." : page()?.text || "(no output)")}
					</text>
				</scrollbox>
				<box height={1} flexDirection="row" gap={2} flexShrink={0}>
					<text
						id="background-older"
						fg={page() && page()!.page < page()!.maxPage ? colors.cyan : colors.subtle}
						onMouseDown={(event) => {
							event.stopPropagation();
							event.preventDefault();
							if (page() && page()!.page < page()!.maxPage) props.onPage(page()!.page + 1);
						}}
					>◀ Older</text>
					<text
						id="background-newer"
						fg={page() && page()!.page > 0 ? colors.cyan : colors.subtle}
						onMouseDown={(event) => {
							event.stopPropagation();
							event.preventDefault();
							if (page() && page()!.page > 0) props.onPage(page()!.page - 1);
						}}
					>Newer ▶</text>
					<text
						id="background-latest"
						fg={colors.cyan}
						onMouseDown={(event) => {
							event.stopPropagation();
							event.preventDefault();
							props.onPage(0);
						}}
					>Latest</text>
					<box flexGrow={1} />
					<text
						id="background-analyze"
						fg={colors.cyan}
						onMouseDown={(event) => {
							event.stopPropagation();
							event.preventDefault();
							props.onAnalyze();
						}}
					>Analyze with Pi</text>
				</box>
				<text height={1} fg={props.error ? colors.red : colors.subtle} wrapMode="none">
					{props.error ?? (props.busy ? "Refreshing…" : page() && page()!.maxPage > 0 ? `Page ${page()!.maxPage - page()!.page + 1} of ${page()!.maxPage + 1}` : "Read-only viewer · does not consume bash_output")}
				</text>
			</DialogFrame>
		</box>
	);
}
