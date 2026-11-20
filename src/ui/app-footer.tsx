/** Footer usage and transient notifications, isolated from App state. */
import type { Accessor } from "solid-js";
import { For } from "solid-js";
import type { Toast } from "../types.ts";
import {
	USAGE_FOOTER_SEPARATOR,
	type UsageFooterSegment,
} from "./usage-footer.ts";
import { colors } from "./theme.ts";

export type AppFooterProps = {
	streaming: Accessor<boolean>;
	statusText: Accessor<string>;
	segments: Accessor<UsageFooterSegment[]>;
	hintText: Accessor<string>;
};

export function AppFooter(props: AppFooterProps) {
	return (
		<box
			height={1}
			flexDirection="row"
			paddingLeft={1}
			paddingRight={1}
			backgroundColor={colors.background}
			overflow="hidden"
		>
			<text
				fg={props.streaming() ? colors.green : colors.muted}
				wrapMode="none"
			>
				{props.statusText()}
			</text>
			<For each={props.segments()}>
				{(segment) => (
					<>
						<text fg={colors.muted} flexShrink={0}>
							{USAGE_FOOTER_SEPARATOR}
						</text>
						<text
							fg={
								segment.tone === "critical"
									? colors.red
									: segment.tone === "warning"
										? colors.yellow
										: colors.muted
							}
							flexShrink={0}
							wrapMode="none"
						>
							{segment.text}
						</text>
					</>
				)}
			</For>
			<box flexGrow={1} />
			<text fg={colors.subtle} wrapMode="none">
				{props.hintText()}
			</text>
		</box>
	);
}

export function ToastOverlay(props: { entries: Accessor<Toast[]> }) {
	return (
		<>
			<For each={props.entries()}>
				{(entry, index) => (
					<box
						position="absolute"
						right={2}
						bottom={4 + index() * 3}
						maxWidth="55%"
						backgroundColor={colors.panelRaised}
						border
						borderColor={
							entry.tone === "error"
								? colors.red
								: entry.tone === "warning"
									? colors.yellow
									: entry.tone === "success"
										? colors.green
										: colors.borderStrong
						}
						paddingLeft={1}
						paddingRight={1}
						zIndex={200}
					>
						<text fg={colors.text} wrapMode="word">
							{entry.text}
						</text>
					</box>
				)}
			</For>
		</>
	);
}
