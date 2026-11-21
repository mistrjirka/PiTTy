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
