/**
 * Runs `pitty founders-setup` (the recommended plugins, PiTTy-BTW and the
 * curated skills) from Settings. The setup script owns every rule: what is
 * recommended, safe-update checks and the settings write. PiTTy only shows
 * its dry-run plan and starts the real run after the user confirms.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type FoundersPlanAction = "present" | "install" | "configure" | "outdated";
export type FoundersPlanEntry = { action: FoundersPlanAction; source: string; name: string };

const PLAN_LINE = /^(Present|Install|Configure|Outdated): (\S+)/;

/** Short name a reader recognises: `git:github.com/x/pi-subagent` -> `pi-subagent`. */
export function foundersPackageName(source: string): string {
	const bare = source.replace(/^(npm|git):/, "").replace(/\.git$/, "");
	const last = bare.split("/").filter(Boolean).at(-1) ?? bare;
	return last.replace(/@[^@]*$/, "") || last;
}

/** Reads the dry-run's `Present:/Install:/Configure:` lines; other lines are prose. */
export function parseFoundersPlan(output: string): FoundersPlanEntry[] {
	const entries: FoundersPlanEntry[] = [];
	for (const line of output.split(/\r?\n/)) {
		const match = PLAN_LINE.exec(line.trim());
		if (!match) continue;
		const source = match[2] ?? "";
		const action: FoundersPlanAction =
			match[1] === "Present"
				? "present"
				: match[1] === "Install"
					? "install"
					: match[1] === "Outdated"
						? "outdated"
						: "configure";
		entries.push({ action, source, name: foundersPackageName(source) });
	}
	return entries;
}

export type FoundersRunResult = { exitCode: number | null; output: string; logPath: string };

/**
 * From a release, the launcher sets PITTY_APP_ROOT and PITTY_NODE_EXECUTABLE.
 * From a source checkout, the script sits two levels above this file.
 */
function foundersScript(): { node: string; script: string; cwd: string } {
	const appRoot = process.env.PITTY_APP_ROOT ?? path.resolve(import.meta.dir, "..", "..");
	return {
		node: process.env.PITTY_NODE_EXECUTABLE || "node",
		script: path.join(appRoot, "scripts", "founders-setup.mjs"),
		cwd: appRoot,
	};
}

export function runFoundersSetup(mode: "dry-run" | "install"): Promise<FoundersRunResult> {
	const { node, script, cwd } = foundersScript();
	const logPath = path.join(os.tmpdir(), `pitty-founders-setup-${mode}.log`);
	const args = mode === "dry-run" ? [script, "--dry-run"] : [script];
	return new Promise((resolve) => {
		const output: string[] = [];
		const finish = (exitCode: number | null) => {
			const text = output.join("");
			try {
				fs.writeFileSync(logPath, text, { mode: 0o600 });
			} catch {
				/* the log is best effort; the result still carries the output */
			}
			resolve({ exitCode, output: text, logPath });
		};
		const child = spawn(node, args, {
			cwd,
			env: { ...process.env, NO_COLOR: "1" },
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => output.push(chunk));
		child.stderr.on("data", (chunk: string) => output.push(chunk));
		child.once("error", (error) => {
			output.push(`\n${error.message}\n`);
			finish(null);
		});
		child.once("close", (code) => finish(code));
	});
}

/** The last error line the script printed, for a one-line failure message. */
export function foundersFailureMessage(output: string): string {
	const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	const failure = [...lines].reverse().find((line) => line.startsWith("PiTTy founders setup failed:"));
	return (failure ?? lines.at(-1) ?? "Setup failed.").replace(/^PiTTy founders setup failed:\s*/, "");
}
