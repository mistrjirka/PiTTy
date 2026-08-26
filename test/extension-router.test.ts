import { describe, expect, test } from "bun:test";
import { ExtensionRequestRouter } from "../src/tabs/extension-router.ts";
import type { RpcExtensionUIRequest } from "../src/types.ts";

const confirm = (id: string): RpcExtensionUIRequest => ({
	type: "extension_ui_request",
	id,
	method: "confirm",
	title: "Confirm",
	message: id,
});

describe("extension request router", () => {
	test("queues background requests and drains only after activation", () => {
		const router = new ExtensionRequestRouter();
		router.setActive("main");
		expect(router.enqueue("tab-1", confirm("one"))).toBeUndefined();
		expect(router.pending("tab-1")).toBe(1);
		expect(router.setActive("tab-1")?.request.id).toBe("one");
		expect(router.complete("tab-1", "one")).toBeUndefined();
	});

	test("keeps FIFO ownership when the active tab receives multiple requests", () => {
		const router = new ExtensionRequestRouter();
		router.setActive("main");
		expect(router.enqueue("main", confirm("one"))?.request.id).toBe("one");
		expect(router.enqueue("main", confirm("two"))).toBeUndefined();
		expect(router.complete("main", "one")?.request.id).toBe("two");
	});
});
