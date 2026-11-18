import { describe, expect, test } from "bun:test";
import {
  BG_STATUS_KEY,
} from "../src/state/background-tasks.ts";
import {
  MCP_ADAPTER_STATUS_KEY, MCP_STATUS_KEY,
} from "../src/state/mcp-status.ts";
import {
  ExtensionStatusController, type ExtensionStatusRuntime,
} from "../src/tabs/extension-status-controller.ts";
import type { RpcExtensionUIRequest } from "../src/types.ts";

function fixture() {
  const changed: string[] = [];
  const runtime: ExtensionStatusRuntime = {
    id: "tab-1", sessionState: { sessionId: "session-1234" },
  };
  const controller = new ExtensionStatusController((rt) => changed.push(rt.id));
  const status = (statusKey: string, statusText?: string): RpcExtensionUIRequest => ({
    type: "extension_ui_request", id: "test-1",
    method: "setStatus", statusKey, statusText,
  });
  return { changed, runtime, controller, status };
}

describe("typed extension status controller", () => {
  test("handles background jobs only from the current session", () => {
    const { changed, runtime, controller, status } = fixture();
    const snapshot = (sessionId: string) => JSON.stringify({
      version: 1, sessionId, tasks: [{
        id: "bg-1", command: "sleep 1", commandTruncated: false,
        cwd: "/tmp", state: "running", startedAt: 1000,
      }],
    });
    expect(controller.handle(status(BG_STATUS_KEY, snapshot("session-2222")), runtime)).toBe(true);
    expect(runtime.background).toBeUndefined();
    expect(controller.handle(status(BG_STATUS_KEY, snapshot("session-1234")), runtime)).toBe(true);
    expect(runtime.background?.tasks[0]?.id).toBe("bg-1");
    expect(changed).toEqual(["tab-1"]);
  });

  test("consumes MCP snapshot, and clears stale metadata when absent", () => {
    const { changed, runtime, controller, status } = fixture();
    const snapshot = JSON.stringify({
      version: 1, servers: [{ name: "example", status: "connected", toolCount: 3, disabled: false }],
      totalTools: 3, connectedCount: 1, disabledCount: 0,
    });
    expect(controller.handle(status(MCP_STATUS_KEY, snapshot), runtime)).toBe(true);
    expect(runtime.mcpStatus?.totalTools).toBe(3);
    expect(controller.handle(status(MCP_STATUS_KEY, undefined), runtime)).toBe(true);
    expect(runtime.mcpStatus).toBeUndefined();
    expect(changed).toHaveLength(2);
  });

  test("retains normal routing of the adapter's footer status", () => {
    const { runtime, controller, status } = fixture();
    expect(controller.handle(status(MCP_ADAPTER_STATUS_KEY, "MCP 1/4"), runtime)).toBe(false);
    expect(runtime.mcpCounts).toEqual({ enabled: 4, connected: 1, disabled: 0 });
    expect(controller.handle(status(MCP_ADAPTER_STATUS_KEY, ""), runtime)).toBe(false);
    expect(runtime.mcpCounts).toBeUndefined();
    expect(controller.handle(status("other-status", "hello"), runtime)).toBe(false);
  });
});
