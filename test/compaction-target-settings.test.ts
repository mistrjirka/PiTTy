import { afterEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	loadCompactionModelState,
	writeCompactionTarget,
} from "../src/config/extension-models.ts";
import { compactionTargetRows } from "../src/ui/compaction-policy.ts";

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function temp() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitty-compaction-target-"));
	roots.push(root);
	const project = path.join(root, "project");
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
	fs.mkdirSync(agentDir, { recursive: true });
	const global = path.join(agentDir, "one-round-compaction.json");
	const projectFile = path.join(project, ".pi", "one-round-compaction.json");
	return { root, project, agentDir, global, projectFile, opts: { cwd: project, agentDir } };
}

test("reads default and global soft targets, preserving other extension settings", async () => {
	const f = temp();
	expect(await loadCompactionModelState(f.opts)).toMatchObject({ targetPostCompactTokens: 40_000, targetScope: "default" });
	fs.writeFileSync(f.global, JSON.stringify({ model: "opencode-go/model", lanes: { audit: { thinkingLevel: "medium" } }, targetPostCompactTokens: 20_000 }));
	expect(await loadCompactionModelState(f.opts)).toMatchObject({ targetPostCompactTokens: 20_000, targetScope: "global" });
	await writeCompactionTarget(50_000, f.opts);
	const saved = JSON.parse(fs.readFileSync(f.global, "utf8"));
	expect(saved).toMatchObject({ targetPostCompactTokens: 50_000, model: "opencode-go/model", lanes: { audit: { thinkingLevel: "medium" } } });
});

test("edits a project override without changing the global target", async () => {
	const f = temp();
	fs.writeFileSync(f.global, JSON.stringify({ targetPostCompactTokens: 20_000, model: "global/model" }));
	fs.writeFileSync(f.projectFile, JSON.stringify({ targetPostCompactTokens: 30_000, model: "project/model", enabled: true }));
	expect(await loadCompactionModelState(f.opts)).toMatchObject({ targetPostCompactTokens: 30_000, targetScope: "project" });
	await writeCompactionTarget(80_000, f.opts);
	expect(JSON.parse(fs.readFileSync(f.projectFile, "utf8"))).toMatchObject({ targetPostCompactTokens: 80_000, model: "project/model", enabled: true });
	expect(JSON.parse(fs.readFileSync(f.global, "utf8")).targetPostCompactTokens).toBe(20_000);
});

test("rejects invalid targets, keeps unknown current values visible and preserves files", async () => {
	const f = temp();
	fs.writeFileSync(f.global, JSON.stringify({ targetPostCompactTokens: 47_000, model: "a/b" }));
	expect(compactionTargetRows(47_000)[0]).toMatchObject({ id: "current:47000", disabledReason: expect.any(String) });
	expect(compactionTargetRows(20_000).find((r) => r.id === "target:20000")?.summary).toContain("Current");
	await expect(writeCompactionTarget(0, f.opts)).rejects.toThrow("positive integer");
	await expect(writeCompactionTarget(1.5, f.opts)).rejects.toThrow("positive integer");
	expect(JSON.parse(fs.readFileSync(f.global, "utf8"))).toEqual({ targetPostCompactTokens: 47_000, model: "a/b" });
	fs.writeFileSync(f.projectFile, JSON.stringify({ targetPostCompactTokens: "invalid" }));
	await expect(loadCompactionModelState(f.opts)).rejects.toThrow("targetPostCompactTokens");
});
