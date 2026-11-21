/** Runtime-owned compaction policy. Extension model files are left to their own controls. */
import { createSignal } from "solid-js";
import type { CacheMaintenanceMode, CompactionMethod } from "../types.ts";
import { COMPACTION_METHOD_LABELS, cacheMaintenanceRows, cacheMaintenanceSummary, compactionMethodRows } from "../ui/compaction-policy.ts";
import type { ExtensionSettingRow } from "../ui/extension-settings.tsx";
import type { ExtensionModelPorts } from "./extension-model-actions.ts";

export function createCompactionPolicyActions(ports: ExtensionModelPorts, refreshExtensionModel: () => Promise<boolean>) {
  const [extensionLoaded, setExtensionLoaded] = createSignal(false);
  const clearError = () => ports.setSettingsErrors((errors) => {
    const next = { ...errors };
    delete next.compaction;
    return next;
  });
  const openSettings = async () => {
    ports.setSettingsSelectedId("compaction");
    const runtime = ports.activeRuntime();
    await ports.refreshState(runtime);
    try {
      setExtensionLoaded((await runtime.client.getCommands()).some((command) => command.name === "one-round-compaction"));
    } catch { setExtensionLoaded(false); }
    await refreshExtensionModel();
    ports.setDetailSettingSelectedId("method");
    ports.setSettingsRoute("compaction");
  };
  const rows = (): ExtensionSettingRow[] => {
    const session = ports.sessionState();
    if (ports.settingsRoute() === "compaction-method") return compactionMethodRows(session, extensionLoaded());
    if (ports.settingsRoute() === "cache-maintenance") return cacheMaintenanceRows();
    const unsupported = session?.compactionMethod === undefined ? "Requires a current Pi runtime" : undefined;
    const status = session?.cacheMaintenanceStatus;
    const detail = status?.state === "inactive" && session?.cacheMaintenance !== "off" ? status.reason : undefined;
    return [
      { id: "method", label: "Method", summary: session?.compactionMethod ? COMPACTION_METHOD_LABELS[session.compactionMethod] : unsupported ?? "Unavailable", ...(unsupported ? { disabledReason: unsupported } : {}) },
      { id: "maintenance", label: "Before cache expiry", summary: cacheMaintenanceSummary(session), ...(unsupported ? { disabledReason: unsupported } : {}), ...(detail ? { detail } : {}) },
    ];
  };
  const apply = async (id: string) => {
    if (ports.settingsBusy()) return;
    const runtime = ports.activeRuntime();
    ports.setSettingsBusy("compaction");
    clearError();
    try {
      if (id.startsWith("method:")) {
        const row = compactionMethodRows(ports.sessionState(), extensionLoaded()).find((item) => item.id === id);
        if (!row || row.disabledReason) throw new Error(row?.disabledReason ?? "Unknown compaction method");
        await runtime.client.setCompactionMethod(id.slice(7) as CompactionMethod);
        ports.setDetailSettingSelectedId("method");
      } else {
        if (!cacheMaintenanceRows().some((row) => row.id === id)) return;
        await runtime.client.setCacheMaintenance(id.slice(12) as CacheMaintenanceMode);
        ports.setDetailSettingSelectedId("maintenance");
      }
      await ports.refreshState(runtime);
      ports.setSettingsRoute("compaction");
    } catch (error) {
      ports.setSettingsErrors((errors) => ({ ...errors, compaction: error instanceof Error ? error.message : String(error) }));
    } finally { ports.setSettingsBusy(undefined); }
  };
  const activate = (id: string): boolean => {
    if (id.startsWith("method:") || id.startsWith("maintenance:")) { void apply(id); return true; }
    if (id === "method") {
      ports.setDetailSettingSelectedId("method:" + (ports.sessionState()?.compactionMethod ?? "cache-aware"));
      ports.setSettingsRoute("compaction-method");
      return true;
    }
    if (id === "maintenance") {
      ports.setDetailSettingSelectedId("maintenance:" + (ports.sessionState()?.cacheMaintenance ?? "compact"));
      ports.setSettingsRoute("cache-maintenance");
      return true;
    }
    return false;
  };
  return { openSettings, rows, activate };
}
