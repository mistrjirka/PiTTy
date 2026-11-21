import { parseProviderUsageSnapshot, PROVIDER_USAGE_STATUS_KEY, type ProviderUsageSnapshot } from "../integrations/provider-usage.ts";
import type { RpcExtensionUIRequest } from "../types.ts";
import {
  BG_STATUS_KEY, parseBackgroundSnapshot, type BackgroundSnapshot,
} from "../state/background-tasks.ts";
import {
  MCP_ADAPTER_STATUS_KEY, MCP_STATUS_KEY, isEmptyMcpStatus,
  parseMcpAdapterStatusText, parseMcpStatusSnapshot, type McpStatusCounts, type McpStatusSnapshot,
} from "../state/mcp-status.ts";
/** Only state modified by the extension-status boundary. */
export type ExtensionStatusRuntime = {
  id: string;
  sessionState?: { sessionId: string } | undefined;
  background?: BackgroundSnapshot;
  providerUsage?: ProviderUsageSnapshot;
  mcpStatus?: McpStatusSnapshot;
  mcpCounts?: McpStatusCounts;
};

/** Owns background-command and MCP status, not dialogs or extension UI requests. */
export class ExtensionStatusController {
  constructor(private readonly onChange: (runtime: ExtensionStatusRuntime) => void) {}

  /** Return true only if the status is fully handled. Footer status must still be routed. */
  handle(event: RpcExtensionUIRequest, runtime: ExtensionStatusRuntime): boolean {
    if (event.method !== "setStatus") return false;
    if (event.statusKey === PROVIDER_USAGE_STATUS_KEY) {
      const snapshot = parseProviderUsageSnapshot(event.statusText);
      if (snapshot && (!snapshot.sessionId || !runtime.sessionState?.sessionId || snapshot.sessionId === runtime.sessionState.sessionId)) {
        runtime.providerUsage = snapshot;
        this.onChange(runtime);
      } else if (event.statusText === undefined && runtime.providerUsage) {
        delete runtime.providerUsage;
        this.onChange(runtime);
      }
      return true;
    }
    if (event.statusKey === BG_STATUS_KEY) {
      const snapshot = typeof event.statusText === "string"
        ? parseBackgroundSnapshot(event.statusText) : undefined;
      if (snapshot && (!runtime.sessionState?.sessionId ||
        snapshot.sessionId === runtime.sessionState.sessionId)) {
        runtime.background = snapshot;
        this.onChange(runtime);
      }
      return true;
    }
    if (event.statusKey === MCP_STATUS_KEY) {
      const snapshot = typeof event.statusText === "string"
        ? parseMcpStatusSnapshot(event.statusText) : undefined;
      if (!snapshot || isEmptyMcpStatus(snapshot)) {
        if (runtime.mcpStatus !== undefined || runtime.mcpCounts !== undefined) {
          delete runtime.mcpStatus;
          delete runtime.mcpCounts;
          this.onChange(runtime);
        }
      } else {
        runtime.mcpStatus = snapshot;
        this.onChange(runtime);
      }
      return true;
    }
    if (event.statusKey === MCP_ADAPTER_STATUS_KEY) {
      // Adapter summary is also a normal footer status, not a consumed event.
      const counts = parseMcpAdapterStatusText(event.statusText);
      if (counts) {
        runtime.mcpCounts = counts;
        this.onChange(runtime);
      } else if (event.statusText == null || event.statusText === "") {
        if (runtime.mcpCounts !== undefined) {
          delete runtime.mcpCounts;
          this.onChange(runtime);
        }
      }
    }
    return false;
  }
}
