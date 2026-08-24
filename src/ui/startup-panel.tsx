import { Show } from "solid-js";
import type { StartupPhase } from "../state/startup.ts";
import { startupExplanation, startupHeading } from "../state/startup.ts";
import { colors } from "./theme.ts";

export function StartupPanel(props: {
	phase: StartupPhase;
	elapsedMs: number;
	spinner: string;
}) {
	const failed = () => props.phase.kind === "failed";
	return (
		<box
			flexGrow={1}
			minHeight={1}
			justifyContent="center"
			alignItems="center"
		>
			<box
				width="80%"
				padding={2}
				backgroundColor={colors.panel}
				border
				borderColor={failed() ? colors.red : colors.borderStrong}
			>
				<text fg={failed() ? colors.red : colors.cyan} attributes={1}>
					{failed() ? "!" : props.spinner} {startupHeading(props.phase)} ·{" "}
					{Math.max(0, Math.floor(props.elapsedMs / 1000))}s
				</text>
				<Show when={startupExplanation(props.phase)}>
					<text fg={colors.muted} wrapMode="word">
						{startupExplanation(props.phase)}
					</text>
				</Show>
			</box>
		</box>
	);
}
