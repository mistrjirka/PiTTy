import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Model settings owned by Pi extensions rather than by Pi itself.
 *
 * `pi-one-round-compaction` reads `one-round-compaction.json` (global under the
 * Pi agent directory, optional project override under `.pi/`) on every
 * compaction. `@mistrjirka/pi-subagent` reads `subagentProfiles` from
 * `settings.json` (global and project) when it spawns a child.
 *
 * PiTTy edits only the model and thinking keys, keeps every other key
 * untouched, and writes atomically because these files are shared with Pi and
 * its extensions.
 */
export type ExtensionModelScope = "global" | "project";

/** Thinking levels accepted by both extensions (Pi's own list has no `off`). */
export const EXTENSION_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ExtensionThinkingLevel = (typeof EXTENSION_THINKING_LEVELS)[number];

export type CompactionModelState = {
	/** Model PiTTy would write if the user picks one now. */
	model?: string;
	thinkingLevel?: string;
	scope: ExtensionModelScope;
	/** File PiTTy updates for a thinking-level change. */
	thinkingScope: ExtensionModelScope;
	globalModel?: string;
	projectModel?: string;
	laneModels: { audit: string | undefined; execution: string | undefined };
	laneThinkingLevel?: {
		audit?: string | undefined;
		execution?: string | undefined;
	};
	/** What each lane actually uses, including the extension's own defaults. */
	effectiveThinking: { audit: string; execution: string };
};

export type SubagentModelSource = ExtensionModelScope | "profile" | "defaults";

export type SubagentModelEntry = {
	/** `"defaults"` or the agent profile name. */
	id: string;
	kind: "defaults" | "agent";
	model?: string;
	thinking?: string;
	source?: SubagentModelSource;
	/** File PiTTy updates for a model change. */
	scope: ExtensionModelScope;
	thinkingSource?: SubagentModelSource;
	/** File PiTTy updates for a thinking-level change. */
	thinkingScope: ExtensionModelScope;
};

const DEFAULT_COMPACTION_THINKING = "low";
const DEFAULT_AUDIT_THINKING = "medium";

export type ExtensionModelOptions = {
	cwd?: string;
	agentDir?: string;
};

type JsonObject = Record<string, unknown>;

const BUILTIN_CORE_PROFILE_NAMES = [
	"explore",
	"implementer",
	"debugging-duck",
] as const;
const BUILTIN_EXTENDED_PROFILE_NAMES = [
	"feasibility",
	"implementation-review",
	"impl-check-behavior",
	"impl-check-contracts",
	"impl-check-design",
	"impl-check-runtime",
] as const;
const THINKING_LEVELS: ReadonlySet<string> = new Set(
	EXTENSION_THINKING_LEVELS,
);

function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function piAgentDir(
	env: NodeJS.ProcessEnv = process.env,
	home = os.homedir(),
): string {
	return env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
}

export function parseModelRef(
	value: string | undefined,
): { provider: string; id: string } | undefined {
	if (!value) return undefined;
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) return undefined;
	return {
		provider: value.slice(0, separator),
		id: value.slice(separator + 1),
	};
}

async function readJsonObject(
	filePath: string,
): Promise<{ exists: boolean; value: JsonObject }> {
	let raw: string;
	try {
		raw = await fsp.readFile(filePath, "utf8");
	} catch (error) {
		if (isMissing(error)) return { exists: false, value: {} };
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Cannot read ${filePath}: ${message(error)}`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`Cannot edit ${filePath}: expected a JSON object`);
	}
	return { exists: true, value: parsed };
}

async function writeJsonObject(
	filePath: string,
	value: JsonObject,
): Promise<void> {
	const directory = path.dirname(filePath);
	await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
	let indent = "  ";
	try {
		const raw = await fsp.readFile(filePath, "utf8");
		const match = /^\{\r?\n([ \t]+)/.exec(raw);
		if (match?.[1]) indent = match[1];
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fsp.writeFile(temporary, `${JSON.stringify(value, null, indent)}\n`, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await fsp.rename(temporary, filePath);
	} catch (error) {
		try {
			await fsp.rm(temporary, { force: true });
		} catch {
			// Keep the original write failure; temp cleanup is best effort.
		}
		throw error;
	}
}

async function readOptionalJson(filePath: string): Promise<JsonObject> {
	return (await readJsonObject(filePath)).value;
}

function settingsPaths(options: ExtensionModelOptions): {
	global: string;
	project: string;
} {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? piAgentDir();
	return {
		global: path.join(agentDir, "settings.json"),
		project: path.join(cwd, ".pi", "settings.json"),
	};
}

function compactionPaths(options: ExtensionModelOptions): {
	global: string;
	project: string;
} {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? piAgentDir();
	return {
		global: path.join(agentDir, "one-round-compaction.json"),
		project: path.join(cwd, ".pi", "one-round-compaction.json"),
	};
}

function laneModel(document: JsonObject, lane: string): string | undefined {
	const lanes = document.lanes;
	if (!isRecord(lanes)) return undefined;
	const value = lanes[lane];
	if (!isRecord(value)) return undefined;
	return stringField(value.model);
}

function laneThinking(document: JsonObject, lane: string): string | undefined {
	const lanes = document.lanes;
	if (!isRecord(lanes)) return undefined;
	const value = lanes[lane];
	if (!isRecord(value)) return undefined;
	const level = stringField(value.thinkingLevel);
	return level && THINKING_LEVELS.has(level) ? level : undefined;
}

export async function loadCompactionModelState(
	options: ExtensionModelOptions = {},
): Promise<CompactionModelState> {
	const paths = compactionPaths(options);
	const globalDocument = await readOptionalJson(paths.global);
	const projectDocument = await readOptionalJson(paths.project);
	const globalModel = stringField(globalDocument.model);
	const projectModel = stringField(projectDocument.model);
	const globalThinkingLevel = stringField(globalDocument.thinkingLevel);
	const projectThinkingLevel = stringField(projectDocument.thinkingLevel);
	const thinkingLevel = projectThinkingLevel ?? globalThinkingLevel;
	const laneModels = {
		audit: laneModel(projectDocument, "audit") ?? laneModel(globalDocument, "audit"),
		execution:
			laneModel(projectDocument, "execution") ??
			laneModel(globalDocument, "execution"),
	};
	const projectLaneThinking = {
		audit: laneThinking(projectDocument, "audit"),
		execution: laneThinking(projectDocument, "execution"),
	};
	const laneThinkingLevel = {
		audit: projectLaneThinking.audit ?? laneThinking(globalDocument, "audit"),
		execution:
			projectLaneThinking.execution ?? laneThinking(globalDocument, "execution"),
	};
	const effectiveThinking = {
		// The extension's DEFAULT_CONFIG pins the audit lane to "medium", so a
		// top-level thinkingLevel alone never reaches it.
		audit: laneThinkingLevel.audit ?? DEFAULT_AUDIT_THINKING,
		execution:
			laneThinkingLevel.execution ??
			thinkingLevel ??
			DEFAULT_COMPACTION_THINKING,
	};
	const model = projectModel ?? globalModel;
	return {
		...(model ? { model } : {}),
		...(thinkingLevel ? { thinkingLevel } : {}),
		scope: projectModel ? "project" : "global",
		thinkingScope:
			projectThinkingLevel ||
			projectLaneThinking.audit ||
			projectLaneThinking.execution
				? "project"
				: "global",
		...(globalModel ? { globalModel } : {}),
		...(projectModel ? { projectModel } : {}),
		laneModels,
		...(laneThinkingLevel.audit || laneThinkingLevel.execution
			? { laneThinkingLevel }
			: {}),
		effectiveThinking,
	};
}

/**
 * Write one compaction thinking level for both lanes.
 *
 * The top-level key alone is not enough: the extension's own defaults pin the
 * audit lane to `medium`, so PiTTy also sets each lane's `thinkingLevel`. Lane
 * models and other lane keys survive.
 */
export async function writeCompactionThinking(
	level: ExtensionThinkingLevel,
	options: ExtensionModelOptions = {},
): Promise<void> {
	if (!THINKING_LEVELS.has(level))
		throw new Error(`Invalid thinking level: ${level}`);
	const paths = compactionPaths(options);
	const state = await loadCompactionModelState(options);
	const target =
		state.thinkingScope === "project" ? paths.project : paths.global;
	const document = await readOptionalJson(target);
	document.thinkingLevel = level;
	const lanes = isRecord(document.lanes)
		? document.lanes
		: (document.lanes = {});
	for (const lane of ["audit", "execution"] as const) {
		const value = isRecord(lanes[lane]) ? lanes[lane] : (lanes[lane] = {});
		value.thinkingLevel = level;
	}
	await writeJsonObject(target, document);
}

export async function writeCompactionModel(
	model: string,
	options: ExtensionModelOptions = {},
): Promise<void> {
	if (!parseModelRef(model)) throw new Error(`Invalid model reference: ${model}`);
	const paths = compactionPaths(options);
	const state = await loadCompactionModelState(options);
	const target = state.scope === "project" ? paths.project : paths.global;
	const document = await readOptionalJson(target);
	document.model = model;
	await writeJsonObject(target, document);
}

function runtimeOverride(value: unknown): {
	model?: string;
	thinking?: string;
} {
	if (!isRecord(value)) return {};
	const model = stringField(value.model);
	const thinking = stringField(value.thinking);
	return {
		...(model ? { model } : {}),
		...(thinking && THINKING_LEVELS.has(thinking) ? { thinking } : {}),
	};
}

function subagentNamespace(document: JsonObject): JsonObject {
	return isRecord(document.subagentProfiles) ? document.subagentProfiles : {};
}

function configuredAgents(namespace: JsonObject): JsonObject {
	return isRecord(namespace.agents) ? namespace.agents : {};
}

function builtinMode(
	globalNamespace: JsonObject,
	projectNamespace: JsonObject,
): "default" | "none" | "all" {
	const value = projectNamespace.builtinAgents ?? globalNamespace.builtinAgents;
	return value === "none" || value === "all" ? value : "default";
}

async function readMarkdownNames(directory: string): Promise<string[]> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fsp.readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => path.basename(entry.name, ".md"));
}

function parseProfileRuntime(raw: string): {
	model?: string;
	thinking?: string;
} {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
	if (!frontmatter?.[1]) return {};
	let model: string | undefined;
	let thinking: string | undefined;
	for (const line of frontmatter[1].split(/\r?\n/)) {
		const match = /^(model|thinking)\s*:\s*(.+?)\s*$/.exec(line);
		if (!match?.[1] || !match[2]) continue;
		const value = match[2].replace(/\s+#.*$/, "").replace(/^(['"])(.*)\1$/, "$2");
		if (!value.trim()) continue;
		if (match[1] === "model") model = value.trim();
		else thinking = THINKING_LEVELS.has(value.trim()) ? value.trim() : undefined;
	}
	return {
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
	};
}

async function readProfileRuntime(
	agentDir: string,
	cwd: string,
): Promise<Map<string, { model?: string; thinking?: string }>> {
	const runtimes = new Map<string, { model?: string; thinking?: string }>();
	// Later scopes override earlier ones, matching pi-subagent discovery.
	for (const directory of [
		path.join(agentDir, "agents"),
		path.join(cwd, ".pi", "agents"),
	]) {
		for (const name of await readMarkdownNames(directory)) {
			try {
				const raw = await fsp.readFile(path.join(directory, `${name}.md`), "utf8");
				runtimes.set(name, parseProfileRuntime(raw));
			} catch (error) {
				if (isMissing(error)) continue;
				throw error;
			}
		}
	}
	return runtimes;
}

export async function loadSubagentModelEntries(
	options: ExtensionModelOptions = {},
): Promise<SubagentModelEntry[]> {
	const cwd = options.cwd ?? process.cwd();
	const agentDir = options.agentDir ?? piAgentDir();
	const paths = settingsPaths(options);
	const globalNamespace = subagentNamespace(await readOptionalJson(paths.global));
	const projectNamespace = subagentNamespace(await readOptionalJson(paths.project));
	const globalDefaults = runtimeOverride(globalNamespace.defaults);
	const projectDefaults = runtimeOverride(projectNamespace.defaults);
	const defaultsModel = projectDefaults.model ?? globalDefaults.model;
	const defaultsThinking = projectDefaults.thinking ?? globalDefaults.thinking;
	const globalAgents = configuredAgents(globalNamespace);
	const projectAgents = configuredAgents(projectNamespace);
	const mode = builtinMode(globalNamespace, projectNamespace);
	const names = new Set<string>();
	if (mode !== "none") {
		for (const name of BUILTIN_CORE_PROFILE_NAMES) names.add(name);
		if (mode === "all")
			for (const name of BUILTIN_EXTENDED_PROFILE_NAMES) names.add(name);
	}
	for (const name of await readMarkdownNames(path.join(agentDir, "agents")))
		names.add(name);
	for (const name of await readMarkdownNames(path.join(cwd, ".pi", "agents")))
		names.add(name);
	for (const name of Object.keys(globalAgents)) names.add(name);
	for (const name of Object.keys(projectAgents)) names.add(name);

	const profileRuntimes = await readProfileRuntime(agentDir, cwd);
	const entries: SubagentModelEntry[] = [
		{
			id: "defaults",
			kind: "defaults",
			...(defaultsModel ? { model: defaultsModel } : {}),
			...(defaultsThinking ? { thinking: defaultsThinking } : {}),
			...(defaultsModel ? { source: projectDefaults.model ? "project" : "global" } : {}),
			scope: projectDefaults.model ? "project" : "global",
			...(defaultsThinking
				? { thinkingSource: projectDefaults.thinking ? "project" : "global" }
				: {}),
			thinkingScope: projectDefaults.thinking ? "project" : "global",
		},
	];
	for (const name of [...names].sort((left, right) =>
		left.localeCompare(right),
	)) {
		const globalValue = runtimeOverride(globalAgents[name]);
		const projectValue = runtimeOverride(projectAgents[name]);
		const profileValue = profileRuntimes.get(name) ?? {};
		const model =
			projectValue.model ?? globalValue.model ?? profileValue.model ?? defaultsModel;
		const thinking =
			projectValue.thinking ??
			globalValue.thinking ??
			profileValue.thinking ??
			defaultsThinking;
		const source: SubagentModelSource | undefined = projectValue.model
			? "project"
			: globalValue.model
				? "global"
				: profileValue.model
					? "profile"
					: defaultsModel
						? "defaults"
						: undefined;
		const thinkingSource: SubagentModelSource | undefined =
			projectValue.thinking
				? "project"
				: globalValue.thinking
					? "global"
					: profileValue.thinking
						? "profile"
						: defaultsThinking
							? "defaults"
							: undefined;
		entries.push({
			id: name,
			kind: "agent",
			...(model ? { model } : {}),
			...(thinking ? { thinking } : {}),
			...(source ? { source } : {}),
			scope: projectValue.model ? "project" : "global",
			...(thinkingSource ? { thinkingSource } : {}),
			thinkingScope: projectValue.thinking ? "project" : "global",
		});
	}
	return entries;
}

async function writeSubagentSetting(
	name: string,
	key: "model" | "thinking",
	value: string,
	scope: ExtensionModelScope,
	options: ExtensionModelOptions,
): Promise<void> {
	const paths = settingsPaths(options);
	const target = scope === "project" ? paths.project : paths.global;
	const document = await readOptionalJson(target);
	const namespace = isRecord(document.subagentProfiles)
		? document.subagentProfiles
		: (document.subagentProfiles = {});
	if (name === "defaults") {
		namespace.defaults = {
			...(isRecord(namespace.defaults) ? namespace.defaults : {}),
			[key]: value,
		};
	} else {
		const agents = isRecord(namespace.agents)
			? namespace.agents
			: (namespace.agents = {});
		agents[name] = {
			...(isRecord(agents[name]) ? (agents[name] as JsonObject) : {}),
			[key]: value,
		};
	}
	await writeJsonObject(target, document);
}

/**
 * Write one agent's model (or the shared defaults) so it is the effective
 * value for this project. Existing thinking and unrelated settings survive.
 */
export async function writeSubagentModel(
	name: string,
	model: string,
	scope: ExtensionModelScope,
	options: ExtensionModelOptions = {},
): Promise<void> {
	if (!parseModelRef(model)) throw new Error(`Invalid model reference: ${model}`);
	await writeSubagentSetting(name, "model", model, scope, options);
}

/** Write one agent's thinking level, preserving its model and other keys. */
export async function writeSubagentThinking(
	name: string,
	level: ExtensionThinkingLevel,
	scope: ExtensionModelScope,
	options: ExtensionModelOptions = {},
): Promise<void> {
	if (!THINKING_LEVELS.has(level))
		throw new Error(`Invalid thinking level: ${level}`);
	await writeSubagentSetting(name, "thinking", level, scope, options);
}
