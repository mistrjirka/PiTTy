import { describe, expect, test } from "bun:test";
import { globalFooterHint } from "../src/app.tsx";
import {
	USAGE_FOOTER_SEPARATOR,
	usageFooterSegments,
	usageFooterWidth,
	type UsageFooterInput,
} from "../src/ui/usage-footer.ts";

const NOW = 1_000_000_000_000;
const sec = NOW / 1000;
const claude = {
	limits: [
		{ kind: "session", label: "5h", percent: 40, resetAt: NOW + (1 * 3600 + 26 * 60) * 1000, active: true },
		{ kind: "week", label: "7d", percent: 12, resetAt: NOW + 3 * 86400_000, active: false },
	],
};
const codex = {
	windows: [
		{ usedPercent: 10, windowSeconds: 18_000, resetAfterSeconds: 1, resetAt: sec + 3600 },
		{ usedPercent: 45, windowSeconds: 604_800, resetAfterSeconds: 1, resetAt: sec + 4 * 86400 + 22 * 3600 + 30 },
	],
};
const opencode = {
	windows: [
		{ usedPercent: 2, windowSeconds: 18_000, resetAfterSeconds: 1, resetAt: sec + 600 },
		{ usedPercent: 3, windowSeconds: 604_800, resetAfterSeconds: 1, resetAt: sec + 2 * 86400 + 4 * 3600 + 30 },
		{ usedPercent: 1, windowSeconds: 2_592_000, resetAfterSeconds: 1, resetAt: sec + 20 * 86400 + 30 },
	],
};
const base: UsageFooterInput = { claudeUsage: claude, codexUsage: codex, opencodeUsage: opencode, width: 200, now: NOW };
const line = (input: UsageFooterInput) =>
	usageFooterSegments(input).map((s) => s.text).join(USAGE_FOOTER_SEPARATOR);

describe("usageFooterSegments", () => {
	test("orders claude, codex, oc with · only on the tightest window", () => {
		expect(line(base)).toBe("claude 40%·1h26m │ codex 45%·4d22h │ oc 2% 3%·2d4h 1%");
		expect(usageFooterSegments(base).map((s) => s.tone)).toEqual(["normal", "normal", "normal"]);
	});
	test("tone: severity, >=80%, and runs-out", () => {
		const hot = { ...base, claudeUsage: { limits: [{ ...claude.limits[0]!, severity: "critical" as const }] } };
		expect(usageFooterSegments(hot)[0]!.tone).toBe("critical");
		const warn = { ...base, codexUsage: { windows: [{ ...codex.windows[1]!, usedPercent: 80 }] } };
		expect(usageFooterSegments(warn)[1]!.tone).toBe("warning");
		const runout = { ...base, opencodeUsageStats: { 604_800: { remainingPercent: 97, runsOutBeforeReset: true } } };
		expect(usageFooterSegments(runout)[2]!.tone).toBe("critical");
		const sev = { ...base, claudeUsage: { limits: [{ ...claude.limits[0]!, severity: "warning" as const }] } };
		expect(usageFooterSegments(sev)[0]!.tone).toBe("warning");
	});
	test("expired login hint replaces percentages", () => {
		const out = usageFooterSegments({ ...base, claudeUsage: undefined, claudeHint: "login expired (run Claude Code)" });
		expect(out[0]).toEqual({ text: "claude login expired", tone: "warning" });
	});
	test("empty input yields nothing", () => {
		expect(usageFooterSegments({ width: 100, now: NOW })).toEqual([]);
	});

	const full = line(base).length; // 54
	test("truncation ladder", () => {
		expect(line({ ...base, width: full - 1 })).toBe("claude 40%·1h26m │ codex 45%·4d22h │ oc 2% 3%·2d4h");
		expect(line({ ...base, width: 47 })).toBe("claude 40%·1h26m │ codex 45%·4d22h │ oc 3%·2d4h");
		expect(line({ ...base, width: 43 })).toBe("claude 40%·1h26m │ oc 3%·2d4h");
		expect(line({ ...base, width: 28 })).toBe("claude 40%·1h26m");
		// Claude-only no longer fits: the worst limit across providers (codex 45%) wins.
		expect(line({ ...base, width: 15 })).toBe("codex 45%·4d22h");
		expect(line({ ...base, width: 14 })).toBe("codex 45%");
		expect(line({ ...base, width: 8 })).toBe("");
	});
	test("falls back to the single worst limit across providers", () => {
		const worst = { ...base, codexUsage: { windows: [{ ...codex.windows[1]!, usedPercent: 91 }] }, width: 15 };
		expect(line(worst)).toBe("codex 91%·4d22h");
		expect(line({ ...worst, width: 10 })).toBe("codex 91%");
	});
	test("never exceeds width at any budget", () => {
		for (let width = 0; width <= 80; width++) {
			const segments = usageFooterSegments({ ...base, width });
			expect(usageFooterWidth(segments)).toBeLessThanOrEqual(width);
		}
	});
	test("footer stays one row from 60 to 200 columns", () => {
		for (let cols = 60; cols <= 200; cols++) {
			const status = "● working";
			const hint = globalFooterHint(cols, false, 0);
			const budget = Math.max(0, cols - 2 - status.length - hint.length - 3 - 2);
			const used = usageFooterWidth(usageFooterSegments({ ...base, width: budget }));
			const total = 2 + status.length + (used ? 3 + used : 0) + hint.length;
			// usage may only take space that is genuinely free (2-col gap kept)
			expect(total).toBeLessThanOrEqual(Math.max(cols - (used ? 2 : 0), 2 + status.length + hint.length));
		}
	});
});
