import { expect, test } from "bun:test";
import { InputActivityTracker } from "../src/tabs/input-activity.ts";

test("typing sends one immediate veto, extends it, then releases it", async () => {
	const sent: boolean[] = [];
	const client = { setInputActive: async (value: boolean) => { sent.push(value); } };
	const tracker = new InputActivityTracker(20);
	try {
		tracker.note(client, true);
		tracker.note(client, true);
		await Promise.resolve();
		expect(sent).toEqual([true]);
		await Bun.sleep(40);
		expect(sent).toEqual([true, false]);
	} finally { tracker.dispose(); }
});
test("clearing or disposing releases the correct tab and preserves RPC order", async () => {
	const a: boolean[] = [];
	const b: boolean[] = [];
	const first = { setInputActive: async (value: boolean) => { a.push(value); } };
	const second = { setInputActive: async (value: boolean) => { b.push(value); } };
	const tracker = new InputActivityTracker(1000);
	tracker.note(first, true);
	tracker.note(second, true);
	tracker.note(first, false);
	tracker.dispose();
	await Bun.sleep(5);
	expect(a).toEqual([true, false]);
	expect(b).toEqual([true, false]);
});
