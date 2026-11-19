#!/usr/bin/env node
/** Verify the installed Monty native worker and persistent state in one package root. */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) {
	throw new Error("Usage: node scripts/check-managed-monty.mjs <package-root>");
}
const require = createRequire(path.join(path.resolve(process.argv[2]), "package.json"));
const { Monty, MontyComplete } = await import(
	pathToFileURL(require.resolve("@pydantic/monty/node")).href
);
const pool = await Monty.create({ minProcesses: 1, maxProcesses: 1, requestTimeout: 5 });
let session;
try {
	session = await pool.checkout({
		limits: { maxFeedDurationSecs: 1, maxMemory: 16 * 1024 * 1024 },
	});
	if (typeof session.loadSnapshot !== "function") throw new Error("Missing snapshot restore");
	const first = await session.feedStart("answer = 40 + 2\nanswer");
	if (!(first instanceof MontyComplete) || first.output !== 42) {
		throw new Error("Native feed failed");
	}
	const state = await session.dump();
	await session.close();
	session = await pool.checkout();
	await session.loadSession(state);
	const restored = await session.feedStart("answer + 1");
	if (!(restored instanceof MontyComplete) || restored.output !== 43) {
		throw new Error("Native restore failed");
	}
} finally {
	try {
		if (session) await session.close();
	} finally {
		await pool.close();
	}
}
console.log("Managed Monty native worker and state restore passed.");
