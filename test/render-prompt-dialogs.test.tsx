import { describe, expect, test } from "bun:test";
import { PromptMapDialog } from "../src/ui/prompt-map.tsx";
import { MemoryBrowserDialog } from "../src/ui/memory-browser.tsx";
import type { MemorySnapshot } from "../src/integrations/memory-store.ts";

import { mount } from "./render-helpers/mount.tsx";

describe("OpenTUI components", () => {
	test("renders a request map for jumping to previous prompts", async () => {
		const setup = await mount(
			() => (
				<PromptMapDialog
					entries={[
						{
							id: "u1",
							text: "Inspect the authentication flow",
							timestamp: 1_700_000_000_000,
						},
						{
							id: "u2",
							text: "Now add regression tests",
							timestamp: 1_700_000_060_000,
						},
					]}
					onSelect={() => {}}
					onCancel={() => {}}
				/>
			),
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Your requests");
		expect(frame).toContain("Inspect the authentication flow");
		expect(frame).toContain("Now add regression tests");
	});

	test("renders a memory browser grouped by source with a search box", async () => {
		const snapshot: MemorySnapshot = {
			files: [],
			projectName: "PiTTy",
			entries: [
				{
					id: "memory:0",
					source: "memory",
					sourceLabel: "Memory",
					filePath: "/home/user/.pi/agent/pi-hermes-memory/MEMORY.md",
					index: 0,
					raw: "User prefers pnpm over npm. <!-- created=2026-07-01, last=2026-07-01 -->",
					text: "User prefers pnpm over npm.",
					category: undefined,
					created: "2026-07-01",
					lastReferenced: "2026-07-01",
					project: undefined,
				},
				{
					id: "failure:0",
					source: "failure",
					sourceLabel: "Failures",
					filePath: "/home/user/.pi/agent/pi-hermes-memory/failures.md",
					index: 0,
					raw: "[correction] Do not edit without authorization. <!-- created=2026-07-02, last=2026-07-02 -->",
					text: "[correction] Do not edit without authorization.",
					category: "correction",
					created: "2026-07-02",
					lastReferenced: "2026-07-02",
					project: undefined,
				},
			],
		};
		const setup = await mount(
			() => (
				<MemoryBrowserDialog
					snapshot={snapshot}
					onRemove={() => {}}
					onCancel={() => {}}
				/>
			),
			100,
			24,
		);
		const frame = setup.captureCharFrame();
		expect(frame).toContain("Memory");
		expect(frame).toContain("Search memory");
		expect(frame).toContain("User prefers pnpm over npm.");
		expect(frame).toContain("correction] Do not edit without authorization.");
	});
});
