import { describe, expect, test } from "bun:test";
import { cacheMaintenanceRows, cacheMaintenanceSummary, compactionMethodRows } from "../src/ui/compaction-policy.ts";
import { settingsBackRoute } from "../src/ui/app-navigation.ts";
import type { RpcSessionState } from "../src/types.ts";

describe("compaction policy choices", () => {
	const state = { compactionMethod: "cache-aware", cacheMaintenance: "compact" } as RpcSessionState;
	test("keeps cache-aware first even when the two-model extension is loaded", () => {
		const rows = compactionMethodRows(state, true);
		expect(rows.map((row) => row.id)).toEqual(["method:cache-aware", "method:extension"]);
		expect(rows.every((row) => !row.disabledReason)).toBe(true);
		expect(state.compactionMethod).toBe("cache-aware");
	});
	test("honours runtime capability rather than guessing from installation", () => {
		const rows = compactionMethodRows({ ...state, compactionMethods: [
			{ id: "cache-aware", available: false, reason: "No isolated cache operation" },
			{ id: "extension", available: false, reason: "Extension disabled" },
		] }, true);
		expect(rows.map((row) => row.disabledReason)).toEqual(["No isolated cache operation", "Extension disabled"]);
		expect(compactionMethodRows(undefined, true).every((row) => row.disabledReason)).toBe(true);
	});
	test("offers compact, keep-warm and off and returns to the compaction menu", () => {
		expect(cacheMaintenanceRows().map((row) => row.id)).toEqual(["maintenance:compact", "maintenance:keep-warm", "maintenance:off"]);
		expect(settingsBackRoute("compaction-method")).toBe("compaction");
		expect(settingsBackRoute("cache-maintenance")).toBe("compaction");
	});
});

test("selected keep-warm shows the runtime's concrete unsupported reason", () => {
	expect(cacheMaintenanceSummary({ cacheMaintenance: "keep-warm", autoCompactionEnabled: true,
		cacheMaintenanceStatus: { state: "inactive", action: "warm", reason: "This provider does not support safe cache warming" },
	})).toBe("Keep cache warm · This provider does not support safe cache warming");
});
