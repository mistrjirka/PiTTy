import { describe, it } from "node:test";
import assert from "node:assert/strict";
import backgroundObserver, { STATUS_KEY, snapshotBackgroundTasks } from "../src/pi-extensions/bg-observer.mjs";

const KEY = Symbol.for("pi-bg-bash.registry");
const SESSION = "01a1e377-d9ba-71bc-bddf-ed676a18dbd6";
const other = "01a1e501-bbcc-dddd-0000-123456789abc";
const makeTask = (id, ownerSessionId, command, state = "running", startedAt = 1000) => ({
	id, ownerSessionId, command, cwd: "/project", state, startedAt,
});

describe("read-only pi-bg observer", () => {
	it("projects original commands and states, excluding other sessions", () => {
		const registry = { tasks: new Map([
			["bg-1", makeTask("bg-1", SESSION, 'echo "quoted $variable"')],
			["bg-2", makeTask("bg-2", other, "private command")],
			["bg-3", makeTask("bg-3", SESSION, "npm test", "exited", 2000)],
		]) };
		const snapshot = snapshotBackgroundTasks(registry, SESSION);
		assert.deepEqual(snapshot.map((row) => row.id), ["bg-3", "bg-1"]);
		assert.equal(snapshot[1].command, 'echo "quoted $variable"');
		assert.equal(snapshot.some((row) => row.command.includes("private")), false);
		assert.equal(snapshot[0].state, "exited");
	});

	it("emits UI-only status and no tool/model hooks", () => {
		const original = globalThis[KEY];
		const handlers = new Map();
		const statuses = [];
		globalThis[KEY] = { tasks: new Map([["bg-1", makeTask("bg-1", SESSION, "sleep 3")]]) };
		try {
			backgroundObserver({ on(name, handler) { handlers.set(name, handler); } });
			assert.deepEqual([...handlers.keys()], ["session_start", "session_shutdown"]);
			handlers.get("session_start")({}, {
				sessionManager: { getSessionId() { return SESSION; } },
				ui: { setStatus(key, value) { statuses.push({ key, value }); } },
			});
			assert.equal(statuses.length, 1);
			assert.equal(statuses[0].key, STATUS_KEY);
			assert.equal(JSON.parse(statuses[0].value).tasks[0].command, "sleep 3");
			handlers.get("session_shutdown")({ reason: "quit" });
		} finally {
			if (original === undefined) delete globalThis[KEY];
			else globalThis[KEY] = original;
		}
	});
});
