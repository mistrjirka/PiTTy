/** Child notifications, questions and fallback custom cards. */
import { Show } from "solid-js";
import type { CustomItem } from "../types.ts";
import { formatDuration } from "./duration.ts";
import {
	clampDiffPath,
	cleanTerminalText,
	collapsedPreview,
	customDetail,
	customDetailObject,
	customDetailsRecord,
	customQuestionParts,
	notificationText,
	objectRecordValue,
	parsedNotification,
} from "./message-format.tsx";
import { colors } from "./theme.ts";
export function CustomMessage(props: { item: CustomItem }) {
	const item = props.item;
	if (item.customType === "subagent-notification") {
		const payload = parsedNotification(item);
		const agentId =
			notificationText(payload.agent_id) || customDetail(item, "agent_id");
		const rawLabel =
			notificationText(payload.label) || customDetail(item, "label");
		const identity = rawLabel.startsWith("@")
			? rawLabel
			: agentId
				? `@${agentId}${rawLabel ? ` — ${rawLabel}` : ""}`
				: "subagent";
		const status =
			notificationText(payload.status) ||
			customDetail(item, "status") ||
			"completed";
		const usage =
			customDetailObject(item, "usage") ?? objectRecordValue(payload.usage);
		const usageParts = [
			typeof usage?.tokens === "number"
				? `${usage.tokens.toLocaleString("en-US")} cumulative tokens (incl. cache)`
				: "",
			typeof usage?.outputTokens === "number"
				? `${usage.outputTokens.toLocaleString("en-US")} generated tokens`
				: "",
			typeof usage?.contextTokens === "number"
				? `~${usage.contextTokens.toLocaleString("en-US")} context tokens`
				: "",
			typeof usage?.toolUses === "number" ? `${usage.toolUses} tools` : "",
			typeof usage?.durationMs === "number"
				? formatDuration(usage.durationMs, "")
				: "",
		].filter(Boolean);
		const result =
			notificationText(payload.result) ||
			customDetail(item, "result") ||
			(customDetailsRecord(item) ? "" : item.text);
		const cleanedResult = cleanTerminalText(result).trim();
		const resultLines = cleanedResult ? cleanedResult.split(/\r?\n/) : [];
		const more =
			resultLines.length > 1
				? `${resultLines.length - 1} more lines`
				: cleanedResult.length > 100
					? "more content"
					: "";
		const sessionPath =
			customDetail(item, "sessionPath") || customDetail(item, "session_path");
		return (
			<box
				id={item.id}
				flexDirection="column"
				backgroundColor={colors.toolAgentBg}
				paddingLeft={1}
				paddingRight={1}
				marginBottom={1}
				border={["left"]}
				borderColor={colors.purple}
			>
				<text fg={colors.purple} attributes={1}>
					◆ subagent · {identity} · {status}
				</text>
				<Show when={usageParts.length > 0}>
					<text fg={colors.muted} wrapMode="word">
						{usageParts.join(" · ")}
					</text>
				</Show>
				<text fg={colors.textBright} selectable wrapMode="none">
					{collapsedPreview(cleanedResult) || "No result preview"}
					{more ? ` · ${more}` : ""}
				</text>
				<Show when={sessionPath}>
					<text fg={colors.subtle} wrapMode="none">
						{clampDiffPath(sessionPath, 72)}
					</text>
				</Show>
			</box>
		);
	}
	const legacyQuestion = item.customType === "subagent_supervisor_request";
	const profiledQuestion = item.customType === "subagent-question";
	const question = legacyQuestion || profiledQuestion;
	const context = profiledQuestion ? customDetail(item, "context") : "";
	const parts = profiledQuestion
		? {
				body: customDetail(item, "question") || item.text,
				hint: context ? `Context: ${context}` : "",
			}
		: customQuestionParts(item);
	const agent = profiledQuestion
		? customDetail(item, "profile") ||
			customDetail(item, "label") ||
			customDetail(item, "agentId") ||
			"subagent"
		: customDetail(item, "agent") || "subagent";
	const reason = legacyQuestion
		? customDetail(item, "reason") || "question"
		: "";
	return question ? (
		<box
			id={item.id}
			flexDirection="column"
			backgroundColor={colors.toolAgentBg}
			paddingLeft={1}
			paddingRight={1}
			marginBottom={1}
			border={["left"]}
			borderColor={colors.purple}
		>
			<text fg={colors.purple} attributes={1}>
				◇ Child question · {agent}
				{reason ? ` · ${reason}` : ""}
			</text>
			<text fg={colors.textBright} selectable wrapMode="word">
				{parts.body}
			</text>
			<Show when={parts.hint}>
				<text fg={colors.muted} selectable wrapMode="word">
					{parts.hint}
				</text>
			</Show>
		</box>
	) : (
		<box id={item.id} paddingLeft={1} marginBottom={1}>
			<text fg={colors.muted} selectable wrapMode="word">
				· {item.customType}: {item.text}
			</text>
		</box>
	);
}
