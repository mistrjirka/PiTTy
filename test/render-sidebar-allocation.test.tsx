import { describe, expect, test } from "bun:test";
import { allocateSidebarPanels } from "../src/ui/sidebar.tsx";

import "./render-helpers/test-env.ts";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

describe("sidebar panel allocation", () => {
	test("allocates agents and notices proportionally", () => {
		expect(
			allocateSidebarPanels(100, { subagents: true, notifications: true }),
		).toEqual({ subagents: 70, notifications: 30 });
	});

	test("gives an absent panel's share to the other", () => {
		expect(
			allocateSidebarPanels(100, { subagents: false, notifications: true }),
		).toEqual({ subagents: 0, notifications: 100 });
		expect(
			allocateSidebarPanels(100, { subagents: true, notifications: false }),
		).toEqual({ subagents: 100, notifications: 0 });
	});

	test("keeps notices no larger than agents and spends exactly the rows owned", () => {
		for (let rows = 0; rows <= 100; rows++) {
			const allocation = allocateSidebarPanels(rows, {
				subagents: true,
				notifications: true,
			});
			expect(allocation.notifications).toBeLessThanOrEqual(
				allocation.subagents,
			);
			expect(allocation.subagents + allocation.notifications).toBe(rows);
		}
	});

	test("prefers agents when rows are below both floors", () => {
		expect(
			allocateSidebarPanels(3, { subagents: true, notifications: true }),
		).toEqual({ subagents: 2, notifications: 1 });
	});
});
