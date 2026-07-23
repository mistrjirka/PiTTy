import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { resolveDefaultPiExecutable, resolvePiCommand } from "../pi-command.ts";

export type OptionalIntegration = {
	packageName: string;
	installed: boolean;
	detectedBy: string[];
};

export type OptionalIntegrationStatus = {
	subagents: OptionalIntegration;
	todos: OptionalIntegration;
	mcpAdapter: OptionalIntegration;
	memory: OptionalIntegration;
	piListError?: string | undefined;
};

function flattenStrings(value: unknown, output: string[] = []): string[] {
	if (typeof value === "string") output.push(value);
	else if (Array.isArray(value))
		for (const item of value) flattenStrings(item, output);
	else if (value && typeof value === "object")
		for (const item of Object.values(value as Record<string, unknown>))
			flattenStrings(item, output);
	return output;
}

function readJsonStrings(file: string): string[] {
	try {
		return flattenStrings(JSON.parse(fs.readFileSync(file, "utf8")));
	} catch {
		return [];
	}
}

function hasPackage(haystack: string, packageName: string): boolean {
	const normalized = haystack.toLowerCase();
	const unscoped = packageName.replace(/^@[^/]+\//, "").toLowerCase();
	return (
		normalized.includes(packageName.toLowerCase()) ||
		normalized.includes(unscoped)
	);
}

type IntegrationOptions = { piExecutable?: string; cwd?: string };
export type OptionalInstallResult = {
	packageName: string;
	command: string[];
	exitCode: number | null;
	logPath: string;
	ok: boolean;
};
export type OptionalInstallOptions = {
	piExecutable?: string;
	cwd?: string;
	logPath?: string;
};

export async function installOptionalIntegrationAsync(
	packageName: string,
	options: OptionalInstallOptions = {},
): Promise<OptionalInstallResult> {
	const cwd = options.cwd ?? process.cwd();
	const executable = options.piExecutable ?? resolveDefaultPiExecutable();
	const command = resolvePiCommand(executable, [
		"install",
		`npm:${packageName}`,
	]);
	const logPath =
		options.logPath ??
		path.join(
			os.tmpdir(),
			`pitty-${packageName.replace(/[^A-Za-z0-9_-]/g, "_")}-install.log`,
		);
	const output: string[] = [];
	const result = await new Promise<number | null>((resolve, reject) => {
		const child = spawn(command.executable, command.args, {
			cwd,
			env: { ...process.env, NO_COLOR: "1" },
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => output.push(chunk));
		child.stderr.on("data", (chunk: string) => output.push(chunk));
		child.once("error", reject);
		child.once("close", (code) => resolve(code));
	});
	try {
		fs.writeFileSync(logPath, output.join(""), { mode: 0o600 });
	} catch {
		/* retained log is best effort */
	}
	return {
		packageName,
		command: [command.executable, ...command.args],
		exitCode: result,
		logPath,
		ok: result === 0,
	};
}

export function installOptionalIntegration(
	packageName: string,
	options: { piExecutable?: string; cwd?: string; logPath?: string } = {},
): OptionalInstallResult {
	const cwd = options.cwd ?? process.cwd();
	const executable = options.piExecutable ?? resolveDefaultPiExecutable();
	const command = resolvePiCommand(executable, [
		"install",
		`npm:${packageName}`,
	]);
	const logPath =
		options.logPath ??
		path.join(
			os.tmpdir(),
			`pitty-${packageName.replace(/[^A-Za-z0-9_-]/g, "_")}-install.log`,
		);
	const result = spawnSync(command.executable, command.args, {
		cwd,
		encoding: "utf8",
		timeout: 120_000,
		windowsHide: true,
		env: { ...process.env, NO_COLOR: "1" },
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	try {
		fs.writeFileSync(logPath, output, { mode: 0o600 });
	} catch {}
	return {
		packageName,
		command: [command.executable, ...command.args],
		exitCode: result.status,
		logPath,
		ok: result.status === 0,
	};
}

export function detectOptionalIntegrations(
	options: IntegrationOptions = {},
): OptionalIntegrationStatus {
	const piExecutable = options.piExecutable ?? resolveDefaultPiExecutable();
	const cwd = options.cwd ?? process.cwd();
	const sources: Array<{ name: string; text: string }> = [];
	let piListError: string | undefined;

	for (const file of [
		path.join(os.homedir(), ".pi", "agent", "settings.json"),
		path.join(cwd, ".pi", "settings.json"),
		path.join(os.homedir(), ".pi", "agent", "npm", "package.json"),
	]) {
		const strings = readJsonStrings(file);
		if (strings.length) sources.push({ name: file, text: strings.join("\n") });
	}

	const moduleRoots = [
		path.join(os.homedir(), ".pi", "agent", "npm", "node_modules"),
		path.join(cwd, ".pi", "npm", "node_modules"),
	];
	const filesystemChecks: Record<string, string[]> = {
		"pi-subagents": moduleRoots.map((root) => path.join(root, "pi-subagents")),
		"@juicesharp/rpiv-todo": moduleRoots.map((root) =>
			path.join(root, "@juicesharp", "rpiv-todo"),
		),
		"pi-mcp-adapter": moduleRoots.map((root) =>
			path.join(root, "pi-mcp-adapter"),
		),
		"pi-hermes-memory": moduleRoots.map((root) =>
			path.join(root, "pi-hermes-memory"),
		),
	};

	const detect = (packageName: string): OptionalIntegration => {
		const detectedBy = sources
			.filter((source) => hasPackage(source.text, packageName))
			.map((source) => source.name);
		for (const candidate of filesystemChecks[packageName] ?? []) {
			try {
				if (fs.existsSync(candidate)) detectedBy.push(candidate);
			} catch {}
		}
		return {
			packageName,
			installed: detectedBy.length > 0,
			detectedBy: [...new Set(detectedBy)],
		};
	};

	let subagents = detect("pi-subagents");
	let todos = detect("@juicesharp/rpiv-todo");
	let mcpAdapter = detect("pi-mcp-adapter");
	let memory = detect("pi-hermes-memory");

	// Local settings/filesystem checks are immediate and cover normal installs.
	// Fall back to `pi list` only when something is still unknown, and keep the
	// timeout short so optional package detection cannot make startup feel hung.
	if (
		!subagents.installed ||
		!todos.installed ||
		!mcpAdapter.installed ||
		!memory.installed
	) {
		try {
			const command = resolvePiCommand(piExecutable, ["list"]);
			const result = spawnSync(command.executable, command.args, {
				cwd,
				encoding: "utf8",
				timeout: 2_500,
				windowsHide: true,
				env: { ...process.env, NO_COLOR: "1" },
			});
			const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
			if (result.status === 0) {
				sources.push({ name: "pi list", text });
				subagents = detect("pi-subagents");
				todos = detect("@juicesharp/rpiv-todo");
				mcpAdapter = detect("pi-mcp-adapter");
				memory = detect("pi-hermes-memory");
			} else {
				piListError =
					text || `pi list exited with status ${result.status ?? "unknown"}`;
			}
		} catch (error) {
			piListError = error instanceof Error ? error.message : String(error);
		}
	}

	return {
		subagents,
		todos,
		mcpAdapter,
		memory,
		...(piListError ? { piListError } : {}),
	};
}
