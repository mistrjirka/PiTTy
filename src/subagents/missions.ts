import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SubagentRun, SubagentStep } from "../types.ts";
import { applyDerivedChildTranscript } from "./artifacts.ts";

export type MissionIdentity = {
	sessionId?: string;
	sessionFile?: string;
};

type MissionRecord = Record<string, unknown>;
type ActiveMission = {
	ownerSessionId: string;
	status: string;
	workflowChildren: unknown[];
};
type ParsedMissionChild = {
	workflowRunId: string;
	step: SubagentStep;
};
type MissionChildFields = {
	child: MissionRecord;
	workflowRunId: string;
	workflowKey: string;
	recordedStatus: string;
	startedAt: number;
	updatedAt: number;
};
type MissionChildLifecycle = {
	status: string;
	completedAt?: number;
	lastActivityAt: number;
};
type MissionRunCandidate = {
	ownerSessionId: string;
	status: string;
	steps: SubagentStep[];
};

const ACTIVE_MISSION_STATES = new Set(["active", "waiting", "needs_decision"]);
const CHILD_STATES = new Set([
	"pending",
	"queued",
	"running",
	"active",
	"working",
	"completed",
	"complete",
	"failed",
	"error",
	"cancelled",
	"canceled",
	"timed_out",
	"paused",
	"stopped",
]);
const OPTIONAL_CHILD_TEXT_FIELDS = [
	"agent",
	"label",
	"phase",
	"runId",
	"sessionPath",
] as const;

function object(value: unknown): MissionRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as MissionRecord)
		: undefined;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function identityVariants(value: string | undefined): Set<string> {
	if (!value?.trim()) return new Set();
	const result = new Set([value.trim()]);
	if (path.isAbsolute(value) || value.includes("/") || value.includes("\\")) {
		const resolved = path.resolve(value);
		result.add(resolved);
		try {
			result.add(fs.realpathSync.native(resolved));
		} catch {
			// The session path may not exist yet; retain its normalized variant.
		}
	}
	return result;
}

function agentDir(sessionFile?: string): string {
	if (sessionFile) {
		const resolved = path.resolve(sessionFile);
		const parts = resolved.split(path.sep);
		const index = parts.lastIndexOf("sessions");
		if (index > 0)
			return parts.slice(0, index).join(path.sep) || path.parse(resolved).root;
	}
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (configured === "~") return os.homedir();
	if (configured?.startsWith("~/"))
		return path.join(os.homedir(), configured.slice(2));
	if (configured) return configured;
	return path.join(os.homedir(), ".pi", "agent");
}

function projectMissionDir(
	projectRoot: string,
	identity: MissionIdentity,
	injectedRoot?: string,
): string {
	if (injectedRoot) return injectedRoot;
	const digest = createHash("sha256")
		.update(path.resolve(projectRoot))
		.digest("hex");
	return path.join(
		agentDir(identity.sessionFile),
		"missions",
		"projects",
		digest,
	);
}

function owns(ownerSessionId: string, identity: MissionIdentity): boolean {
	if (!identity.sessionId && !identity.sessionFile) return false;
	const expected = new Set([
		...identityVariants(identity.sessionId),
		...identityVariants(identity.sessionFile),
	]);
	return [...identityVariants(ownerSessionId)].some((variant) =>
		expected.has(variant),
	);
}

function missionFiles(root: string): string[] {
	try {
		return fs
			.readdirSync(root)
			.flatMap((name) =>
				name.endsWith(".json") ? [path.join(root, name)] : [],
			);
	} catch {
		return [];
	}
}

function readActiveMission(
	file: string,
	identity: MissionIdentity,
): ActiveMission | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	const record = object(raw);
	if (!record || record.schemaVersion !== 1) return undefined;
	const ownerSessionId = text(record.ownerSessionId);
	const status = text(record.status);
	if (
		!ownerSessionId ||
		!status ||
		!ACTIVE_MISSION_STATES.has(status) ||
		!owns(ownerSessionId, identity) ||
		!Array.isArray(record.workflowChildren) ||
		record.workflowChildren.length === 0
	)
		return undefined;
	return {
		ownerSessionId,
		status,
		workflowChildren: record.workflowChildren,
	};
}

function optionalChildFieldsAreValid(child: MissionRecord): boolean {
	return OPTIONAL_CHILD_TEXT_FIELDS.every(
		(field) => child[field] === undefined || text(child[field]) !== undefined,
	);
}

function parseMissionChildFields(
	value: unknown,
): MissionChildFields | undefined {
	const child = object(value);
	if (!child) return undefined;
	const workflowRunId = text(child.workflowRunId);
	const workflowKey = text(child.key);
	const recordedStatus = text(child.status);
	const startedAt = timestamp(child.startedAt);
	const updatedAt = timestamp(child.updatedAt);
	const artifactPaths = child.artifactPaths;
	if (
		!workflowRunId ||
		!workflowKey ||
		!recordedStatus ||
		!CHILD_STATES.has(recordedStatus) ||
		startedAt === undefined ||
		updatedAt === undefined ||
		!Array.isArray(artifactPaths) ||
		artifactPaths.some((item) => typeof item !== "string") ||
		!optionalChildFieldsAreValid(child)
	)
		return undefined;
	return {
		child,
		workflowRunId,
		workflowKey,
		recordedStatus,
		startedAt,
		updatedAt,
	};
}

function parseMissionChildLifecycle(
	child: MissionRecord,
	recordedStatus: string,
	updatedAt: number,
): MissionChildLifecycle | undefined {
	const heartbeatValue = child.heartbeat;
	const heartbeat =
		heartbeatValue === undefined ? undefined : object(heartbeatValue);
	const heartbeatStatus = text(heartbeat?.status);
	const heartbeatAt = timestamp(heartbeat?.updatedAt);
	const completedAt = timestamp(child.completedAt);
	if (
		(heartbeatValue !== undefined && !heartbeat) ||
		(heartbeat !== undefined && heartbeatAt === undefined) ||
		(heartbeatStatus !== undefined && !CHILD_STATES.has(heartbeatStatus)) ||
		(child.completedAt !== undefined && completedAt === undefined)
	)
		return undefined;
	return {
		status: heartbeatStatus ?? recordedStatus,
		...(completedAt !== undefined ? { completedAt } : {}),
		lastActivityAt: heartbeatAt ?? updatedAt,
	};
}

function parseMissionChild(
	value: unknown,
	index: number,
	projectRoot: string,
	ownerSessionFile?: string,
): ParsedMissionChild | undefined {
	const fields = parseMissionChildFields(value);
	if (!fields) return undefined;
	const lifecycle = parseMissionChildLifecycle(
		fields.child,
		fields.recordedStatus,
		fields.updatedAt,
	);
	if (!lifecycle) return undefined;
	const step: SubagentStep = {
		index,
		agent: text(fields.child.agent) ?? fields.workflowKey,
		workflowKey: fields.workflowKey,
		parentWorkflowRunId: fields.workflowRunId,
		status: lifecycle.status,
		...(text(fields.child.phase) ? { phase: text(fields.child.phase) } : {}),
		...(text(fields.child.label) ? { label: text(fields.child.label) } : {}),
		...(text(fields.child.runId) ? { runId: text(fields.child.runId) } : {}),
		...(text(fields.child.sessionPath)
			? { sessionFile: text(fields.child.sessionPath) }
			: {}),
		startedAt: fields.startedAt,
		...(lifecycle.completedAt !== undefined
			? { endedAt: lifecycle.completedAt }
			: {}),
		lastActivityAt: lifecycle.lastActivityAt,
	};
	applyDerivedChildTranscript(step, projectRoot, ownerSessionFile);
	return { workflowRunId: fields.workflowRunId, step };
}

function workflowSteps(
	values: readonly unknown[],
	projectRoot: string,
	ownerSessionFile?: string,
): Map<string, SubagentStep[]> | undefined {
	const byRun = new Map<string, SubagentStep[]>();
	for (const [index, value] of values.entries()) {
		const parsed = parseMissionChild(value, index, projectRoot, ownerSessionFile);
		if (!parsed) return undefined;
		const steps = byRun.get(parsed.workflowRunId) ?? [];
		if (steps.some((step) => step.workflowKey === parsed.step.workflowKey))
			return undefined;
		steps.push(parsed.step);
		byRun.set(parsed.workflowRunId, steps);
	}
	return byRun;
}

function missionRun(
	runId: string,
	candidate: MissionRunCandidate,
): SubagentRun {
	return {
		runId,
		control: "mission",
		sessionId: candidate.ownerSessionId,
		mode: "workflow",
		state: candidate.status,
		steps: candidate.steps,
		startedAt: Math.min(
			...candidate.steps.map(
				(step) => step.startedAt ?? Number.MAX_SAFE_INTEGER,
			),
		),
		lastUpdate: Math.max(
			...candidate.steps.map((step) => step.lastActivityAt ?? 0),
		),
	};
}

export function listMissionRuns(
	identity: MissionIdentity,
	projectRoot: string,
	injectedRoot?: string,
): SubagentRun[] {
	if (!identity.sessionId && !identity.sessionFile) return [];
	const root = projectMissionDir(projectRoot, identity, injectedRoot);
	const candidates = new Map<string, MissionRunCandidate[]>();
	for (const file of missionFiles(root)) {
		const mission = readActiveMission(file, identity);
		if (!mission) continue;
		const grouped = workflowSteps(mission.workflowChildren, projectRoot, mission.ownerSessionId);
		if (!grouped) continue;
		for (const [runId, steps] of grouped) {
			const candidate: MissionRunCandidate = {
				ownerSessionId: mission.ownerSessionId,
				status: mission.status,
				steps,
			};
			candidates.set(runId, [...(candidates.get(runId) ?? []), candidate]);
		}
	}

	const runs: SubagentRun[] = [];
	for (const [runId, matching] of candidates) {
		if (matching.length !== 1) continue;
		const candidate = matching[0];
		if (candidate) runs.push(missionRun(runId, candidate));
	}
	return runs;
}

export function mergeMissionRuns(
	persisted: readonly SubagentRun[],
	identity: MissionIdentity,
	projectRoot: string,
	injectedRoot?: string,
): SubagentRun[] {
	const persistedIds = new Set(persisted.map((run) => run.runId));
	return [
		...persisted,
		...listMissionRuns(identity, projectRoot, injectedRoot).filter(
			(run) => !persistedIds.has(run.runId),
		),
	];
}
