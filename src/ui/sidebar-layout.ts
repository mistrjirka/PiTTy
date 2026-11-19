import type { NotificationRecord } from "../types.ts";
import { colors } from "./theme.ts";

export type SidebarPanelVisibility = {
	subagents: boolean;
	todos: boolean;
	notifications: boolean;
};

export type SidebarPanelAllocation = {
	subagents: number;
	todos: number;
	notifications: number;
};

const PANEL_KEYS = ["subagents", "todos", "notifications"] as const;

const PANEL_WEIGHTS: SidebarPanelAllocation = {
	subagents: 50,
	todos: 30,
	notifications: 20,
};

const PANEL_FLOORS: SidebarPanelAllocation = {
	subagents: 2,
	todos: 4,
	notifications: 3,
};

export function mcpSummaryText(counts: {
	enabled: number;
	connected: number;
}): string {
	return `🔌 MCP ${counts.connected}/${counts.enabled} connected`;
}

export function mcpSummaryColor(
	counts: { enabled: number; connected: number },
	failed: boolean,
): string {
	if (failed) return colors.red;
	if (counts.enabled > 0 && counts.connected >= counts.enabled)
		return colors.green;
	if (counts.connected === 0) return colors.subtle;
	return colors.yellow;
}

export function allocateSidebarPanels(
	availableRows: number,
	visibility: SidebarPanelVisibility,
): SidebarPanelAllocation {
	const rows = Math.max(0, Math.floor(availableRows));
	const allocation: SidebarPanelAllocation = {
		subagents: 0,
		todos: 0,
		notifications: 0,
	};
	let visible = PANEL_KEYS.filter((panel) => visibility[panel]);
	if (
		visibility.subagents &&
		visibility.todos &&
		visibility.notifications &&
		rows < 11
	) {
		visible = visible.filter((panel) => panel !== "notifications");
	}
	const totalWeight = visible.reduce(
		(sum, panel) => sum + PANEL_WEIGHTS[panel],
		0,
	);
	if (!totalWeight) return allocation;
	const fractions = visible.map((panel) => ({
		panel,
		share: (rows * PANEL_WEIGHTS[panel]) / totalWeight,
	}));
	for (const entry of fractions)
		allocation[entry.panel] = Math.floor(entry.share);
	let remainder =
		rows - visible.reduce((sum, panel) => sum + allocation[panel], 0);
	for (const entry of fractions.sort((a, b) => (b.share % 1) - (a.share % 1))) {
		if (!remainder) break;
		allocation[entry.panel] += 1;
		remainder -= 1;
	}
	const floorTotal = visible.reduce(
		(sum, panel) => sum + PANEL_FLOORS[panel],
		0,
	);
	if (rows < floorTotal) {
		allocation.subagents = 0;
		allocation.todos = 0;
		allocation.notifications = 0;
		let remainingRows = rows;
		const priority = fractions.sort((a, b) => b.share - a.share);
		while (remainingRows > 0) {
			for (const entry of priority) {
				if (!remainingRows) break;
				allocation[entry.panel] += 1;
				remainingRows -= 1;
			}
		}
		return allocation;
	}
	for (const panel of visible) {
		let deficit = PANEL_FLOORS[panel] - allocation[panel];
		if (deficit <= 0) continue;
		allocation[panel] = PANEL_FLOORS[panel];
		for (const donor of visible) {
			const donated = Math.min(
				deficit,
				Math.max(0, allocation[donor] - PANEL_FLOORS[donor]),
			);
			allocation[donor] -= donated;
			deficit -= donated;
			if (deficit === 0) break;
		}
	}
	return allocation;
}

export function notificationToneColor(
	tone: NotificationRecord["tone"],
): string {
	if (tone === "error") return colors.red;
	if (tone === "warning") return colors.yellow;
	if (tone === "success") return colors.green;
	return colors.borderStrong;
}

export function notificationToneIcon(tone: NotificationRecord["tone"]): string {
	if (tone === "error") return "❌";
	if (tone === "warning") return "⚠️";
	if (tone === "success") return "✅";
	return "🔔";
}
