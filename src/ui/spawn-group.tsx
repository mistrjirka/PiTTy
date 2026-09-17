import { For, Show, type JSX } from "solid-js";
import type { ConversationItem, ToolItem } from "../types.ts";
import { isProfiledSubagentTool, isSubagentFamilyToolName } from "../subagents/profiled.ts";
import type { SubagentTarget } from "../subagents/targets.ts";
import { colors } from "./theme.ts";
import {
	friendlyTargetState,
	stateIcon,
	targetFreshness,
	targetToolUsage,
} from "./model-context.tsx";

/**
 * Grouped parallel-spawn card ("option 1A").
 *
 * A contiguous batch of subagent spawns used to render as N separate tool
 * cards (~9 rows per spawn). This module collapses such a batch into ONE card
 * with a single row per child, plus a toggle that expands it back to today's
 * per-spawn cards so nothing becomes unreachable.
 */

/**
 * Prefix for synthetic group ids. Generated conversation item ids always have
 * the shape `prefix-base36time-random` (see `id()` in
 * `src/state/conversation.ts`: `history-tool-…`, `tool-…`, …) and never
 * contain a colon, so `group:<firstItemId>` cannot collide with a real tool
 * item id. The key is derived from the group's first item id: stable within a
 * render/session (and therefore usable with the existing per-runtime
 * `expandedToolIds` plumbing), but not assumed to survive a session reload —
 * item ids themselves are regenerated per item creation.
 */
export const SPAWN_GROUP_ID_PREFIX = "group:";

export function spawnGroupId(firstItemId: string): string {
	return `${SPAWN_GROUP_ID_PREFIX}${firstItemId}`;
}

/** A contiguous run (in visible-items order) of ≥2 groupable spawn items. */
export type SpawnGroup = {
	/** Synthetic id (`group:<firstItemId>`); never collides with item ids. */
	id: string;
	/** Member tool item ids, in the order their cards would have appeared. */
	memberIds: string[];
	/** Owned targets across all members, in card order. */
	targets: SubagentTarget[];
};

/**
 * Whether a tool item is a subagent spawn (and therefore groupable). Uses
 * the shared `isSubagentFamilyToolName` rule so grouping agrees with the
 * purple agent tone in `toolVisual` (`src/ui/message.tsx`) and with target
 * ownership in `src/subagents/targets.ts`.
 */
export function isSpawnToolItem(item: ToolItem): boolean {
	return isSubagentFamilyToolName(item.name) || isProfiledSubagentTool(item);
}

/**
 * Grouping unit: a contiguous run, in visible-items order, of ≥2 tool items
 * that are subagent spawn tools and that each own at least one target.
 *
 * Strict on purpose: any intervening non-spawn item (assistant text, another
 * tool, …) ends the run so unrelated spawns never merge, and a spawn that
 * owns zero targets renders as a normal card and is never swallowed by a
 * group, so failures stay visible. Single spawns are not groups and render
 * exactly as today.
 */
export function computeSpawnGroups(
	items: readonly ConversationItem[],
	owned: ReadonlyMap<string, readonly SubagentTarget[]>,
): SpawnGroup[] {
	const groups: SpawnGroup[] = [];
	let run: ToolItem[] = [];
	const flush = () => {
		const first = run[0];
		if (run.length >= 2 && first !== undefined) {
			groups.push({
				id: spawnGroupId(first.id),
				memberIds: run.map((item) => item.id),
				targets: run.flatMap((item) => owned.get(item.id) ?? []),
			});
		}
		run = [];
	};
	for (const item of items) {
		if (
			item.kind === "tool" &&
			isSpawnToolItem(item) &&
			(owned.get(item.id)?.length ?? 0) > 0
		) {
			run.push(item);
			continue;
		}
		flush();
	}
	flush();
	return groups;
}

type GroupBucket = "working" | "waiting" | "resident" | "unresponsive" | "failed" | "finished";

const BUCKET_ORDER: readonly GroupBucket[] = [
	"working",
	"waiting",
	"resident",
	"unresponsive",
	"failed",
	"finished",
];

/**
 * Compact header bucket for a raw target state. Unknown states return
 * undefined and are counted in `×N` only — the header never prints a raw
 * state string.
 */
function bucketForState(state: string): GroupBucket | undefined {
	switch (state) {
		case "running":
		case "queued":
		case "active":
		case "working":
			return "working";
		case "waiting":
			return "waiting";
		case "idle":
			return "resident";
		case "unresponsive":
			return "unresponsive";
		case "failed":
		case "error":
		case "timed_out":
			return "failed";
		case "completed":
			return "finished";
		default:
			return undefined;
	}
}

/**
 * Compact breakdown of the friendly states actually present, e.g.
 * `2 working · 2 finished`. Zero-count categories are omitted; the caller
 * prefixes it with `◇ Agents ×N`.
 */
export function spawnGroupSummary(targets: readonly SubagentTarget[]): string {
	const counts = new Map<GroupBucket, number>();
	for (const target of targets) {
		const bucket = bucketForState(target.state);
		if (bucket !== undefined) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}
	return BUCKET_ORDER.filter((bucket) => (counts.get(bucket) ?? 0) > 0)
		.map((bucket) => `${counts.get(bucket)} ${bucket}`)
		.join(" · ");
}

/**
 * One grouped row per child: `{icon} {label} · {friendly} · {freshness} ·
 * {usage}`. Freshness and usage come from the same shared helpers as the
 * sidebar rows; an empty usage (`""`) is omitted so the state word never
 * prints twice, and `starting…` is never printed for a non-working state (a
 * defensive omit — `targetToolUsage` already restricts it to
 * running/queued).
 */
export function spawnGroupRowText(
	target: SubagentTarget,
	now: number,
): string {
	const friendly = friendlyTargetState(target.state);
	const usage = targetToolUsage(target);
	const visibleUsage =
		usage === "" || (usage === "starting…" && friendly !== "working")
			? undefined
			: usage;
	return (
		`${stateIcon(target.state)} ${target.label} · ${friendly} · ` +
		`${targetFreshness(target, now)}` +
		(visibleUsage ? ` · ${visibleUsage}` : "")
	);
}

export function SpawnGroupCard(props: {
	group: SpawnGroup;
	expanded: boolean;
	now: number;
	onToggle: (groupId: string) => void;
	onInspectSubagentTarget?: ((targetKey: string) => void) | undefined;
	/** Renders one member through exactly today's per-item `MessageView` path. */
	renderMember: (memberId: string) => JSX.Element | null;
}) {
	const summary = () => spawnGroupSummary(props.group.targets);
	const header = () =>
		`◇ Agents ×${props.group.targets.length}${summary() ? ` · ${summary()}` : ""}`;
	return (
		<box
			id={props.group.id}
			flexDirection="column"
			backgroundColor={colors.toolAgentBg}
			paddingLeft={1}
			paddingRight={1}
			marginBottom={1}
			border={["left"]}
			borderColor={colors.purple}
		>
			<box flexDirection="row">
				<text fg={colors.purple} attributes={1} wrapMode="none">
					{header()}
				</text>
				<box flexGrow={1} />
				<box
					id={`${props.group.id}-toggle`}
					height={1}
					flexShrink={0}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
						props.onToggle(props.group.id);
					}}
				>
					<text fg={colors.cyan} wrapMode="none">
						{props.expanded ? "▾ spawn cards" : "▸ spawn cards"}
					</text>
				</box>
			</box>
			<Show when={!props.expanded}>
				<For each={props.group.targets}>
					{(target) => (
						<box
							height={1}
							minHeight={1}
							flexShrink={0}
							flexDirection="row"
							onMouseDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								props.onInspectSubagentTarget?.(target.key);
							}}
						>
							<text fg={colors.text} wrapMode="none">
								{spawnGroupRowText(target, props.now)}
							</text>
						</box>
					)}
				</For>
			</Show>
			<Show when={props.expanded}>
				<For each={props.group.memberIds}>
					{(memberId) => props.renderMember(memberId)}
				</For>
			</Show>
		</box>
	);
}
