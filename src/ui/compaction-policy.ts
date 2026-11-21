import type { CacheMaintenanceMode, CompactionMethod, RpcSessionState } from "../types.ts";
import type { ExtensionSettingRow } from "./extension-settings.tsx";

export const COMPACTION_METHOD_LABELS: Record<CompactionMethod, string> = {
	"cache-aware": "Cache-aware",
	extension: "Two-model extension",
};
export const CACHE_MAINTENANCE_LABELS: Record<CacheMaintenanceMode, string> = {
	compact: "Compact before expiry",
	"keep-warm": "Keep cache warm",
	off: "Off",
};

export function compactionMethodRows(state: Pick<RpcSessionState, "compactionMethod" | "compactionMethods"> | undefined, extensionLoaded = false): ExtensionSettingRow[] {
	return (["cache-aware", "extension"] as const).map((method) => {
		const capability = state?.compactionMethods?.find((entry) => entry.id === method);
		const available = state?.compactionMethod !== undefined &&
			(capability?.available ?? (method === "extension" ? extensionLoaded : true));
		const reason = state?.compactionMethod === undefined
			? "Requires a Pi runtime with compaction policy support"
			: capability?.reason ?? (method === "extension" ? "One-round compaction is not loaded" : "Unavailable for this provider");
		return {
			id: "method:" + method,
			label: COMPACTION_METHOD_LABELS[method],
			summary: available
				? method === "cache-aware" ? "Use the current conversation cache" : "Use the configured audit and execution models"
				: reason,
			...(!available ? { disabledReason: reason } : {}),
		};
	});
}

/** Presets for the extension's soft checkpoint target, not a continuous cache limit. */
export const COMPACTION_TARGET_PRESETS = [10_000, 20_000, 30_000, 40_000, 50_000, 80_000, 100_000, 200_000] as const;
export function compactionTargetRows(current: number): ExtensionSettingRow[] {
	const choices: ExtensionSettingRow[] = COMPACTION_TARGET_PRESETS.map((tokens) => ({
		id: `target:${tokens}`,
		label: `${(tokens / 1000).toLocaleString("en-US")}k tokens`,
		summary: tokens === current ? "Current · soft target" : "Soft target after compaction",
	}));
	if (!COMPACTION_TARGET_PRESETS.some((tokens) => tokens === current)) {
		choices.unshift({ id: `current:${current}`, label: `Current: ${current.toLocaleString("en-US")} tokens`,
			summary: "Custom value configured in JSON", disabledReason: "Choose a preset, or edit one-round-compaction.json for a custom target" });
	}
	return choices;
}

export function cacheMaintenanceRows(): ExtensionSettingRow[] {
	return [
		{ id: "maintenance:compact", label: CACHE_MAINTENANCE_LABELS.compact, summary: "Save a checkpoint before the cache expires" },
		{ id: "maintenance:keep-warm", label: CACHE_MAINTENANCE_LABELS["keep-warm"], summary: "Refresh the existing cache when supported" },
		{ id: "maintenance:off", label: CACHE_MAINTENANCE_LABELS.off, summary: "Do not run maintenance before cache expiry" },
	];
}

export function cacheMaintenanceSummary(state: Pick<RpcSessionState, "cacheMaintenance" | "cacheMaintenanceStatus" | "autoCompactionEnabled"> | undefined): string {
	if (!state?.cacheMaintenance) return "Requires a current Pi runtime";
	const label = CACHE_MAINTENANCE_LABELS[state.cacheMaintenance];
	if (state.cacheMaintenance === "compact" && state.autoCompactionEnabled === false)
		return label + " · paused by /autocompact off";
	const status = state.cacheMaintenanceStatus;
	return status?.state === "inactive" && state.cacheMaintenance !== "off" && status.reason
		? label + " · " + status.reason : label;
}
