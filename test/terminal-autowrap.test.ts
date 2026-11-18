import { describe, expect, test } from "bun:test";
import {
	disableTerminalAutowrap, DISABLE_AUTOWRAP, RESTORE_AUTOWRAP,
} from "../src/ui/terminal-autowrap.ts";

function fixture() {
	const output: string[] = [];
	const write = (text: string) => { output.push(text); };
	return { output, write };
}

describe("terminal autowrap guard", () => {
	test("disables autowrap on an interactive POSIX tty and restores it exactly once", () => {
		const { output, write } = fixture();
		const restore = disableTerminalAutowrap({ isTTY: true, fd: 1 }, { platform: "linux", write });
		expect(output).toEqual([DISABLE_AUTOWRAP]);
		restore();
		restore();
		expect(output).toEqual([DISABLE_AUTOWRAP, RESTORE_AUTOWRAP]);
	});

	test("never changes stdout when not a real tty or when explicitly opted out", () => {
		const { output, write } = fixture();
		const cases = [
			{ isTTY: false, fd: 1 },
			{ isTTY: undefined, fd: 1 },
			{ isTTY: true, fd: undefined },
			{ isTTY: true, fd: -1 },
			{ isTTY: true, fd: Number.NaN },
		];
		for (const candidate of cases) {
			const restore = disableTerminalAutowrap(candidate, { platform: "linux", write });
			restore();
		}
		const allow = disableTerminalAutowrap({ isTTY: true, fd: 1 }, {
			platform: "linux", write, allowAutowrap: true,
		});
		allow();
		const windows = disableTerminalAutowrap({ isTTY: true, fd: 1 }, {
			platform: "win32", write,
		});
		windows();
		expect(output).toEqual([]);
	});

	test("failure to write the disable code does not risk restoring a mode never changed", () => {
		const output: string[] = [];
		let failed = false;
		const restore = disableTerminalAutowrap({ isTTY: true, fd: 1 }, {
			platform: "linux",
			write: (value) => {
				output.push(value);
				if (!failed) { failed = true; throw new Error("tty closed"); }
			},
		});
		restore();
		expect(output).toEqual([DISABLE_AUTOWRAP]);
	});

	test("teardown tolerates a closed tty but never retries after a failed restore", () => {
		const output: string[] = [];
		const restore = disableTerminalAutowrap({ isTTY: true, fd: 1 }, {
			platform: "darwin",
			write: (value) => {
				output.push(value);
				if (value === RESTORE_AUTOWRAP) throw new Error("pty already closed");
			},
		});
		expect(() => restore()).not.toThrow();
		restore();
		expect(output).toEqual([DISABLE_AUTOWRAP, RESTORE_AUTOWRAP]);
	});
});
