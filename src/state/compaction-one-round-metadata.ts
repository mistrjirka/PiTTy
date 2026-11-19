/** Compaction one-round field validators | compaction-one-round-metadata. */

import type {
	OneRoundDurableUserReference,
	OneRoundGit,
	OneRoundIntentWorkflow,
	OneRoundRenderBudgets,
	OneRoundRenderBudgetsV6,
	OneRoundUserArtifactLocator,
	OneRoundUserMessage,
} from "./compaction-model.ts";
import { hasOnlyKeys, isStringArray } from "./compaction-one-round-lanes.ts";
import {
	isFiniteNonNegative,
	isFiniteNonNegativeInteger,
	isRecord,
} from "./compaction-validation.ts";

export function parseOneRoundUserMessage(
	value: unknown,
): OneRoundUserMessage | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["timestamp", "text", "originalChars", "trimmed"]) ||
		!isFiniteNonNegative(value.timestamp) ||
		typeof value.text !== "string" ||
		!isFiniteNonNegativeInteger(value.originalChars) ||
		typeof value.trimmed !== "boolean"
	) {
		return undefined;
	}
	return {
		timestamp: value.timestamp,
		text: value.text,
		originalChars: value.originalChars,
		trimmed: value.trimmed,
	};
}

export function parseOneRoundUserMessages(
	value: unknown,
): OneRoundUserMessage[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const messages: OneRoundUserMessage[] = [];
	for (const item of value) {
		const message = parseOneRoundUserMessage(item);
		if (message === undefined) return undefined;
		messages.push(message);
	}
	return messages;
}

export function parseOneRoundDurableReference(
	value: unknown,
): OneRoundDurableUserReference | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["id", "state", "misses", "semanticNote"]) ||
		typeof value.id !== "string" ||
		(value.state !== "active" && value.state !== "cooling") ||
		!isFiniteNonNegativeInteger(value.misses) ||
		(value.semanticNote !== undefined && typeof value.semanticNote !== "string")
	)
		return undefined;
	return {
		id: value.id,
		state: value.state,
		misses: value.misses,
		...(typeof value.semanticNote === "string"
			? { semanticNote: value.semanticNote }
			: {}),
	};
}

export function parseOneRoundDurableReferences(
	value: unknown,
): OneRoundDurableUserReference[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const references: OneRoundDurableUserReference[] = [];
	for (const item of value) {
		const reference = parseOneRoundDurableReference(item);
		if (reference === undefined) return undefined;
		references.push(reference);
	}
	return references;
}

export function parseOneRoundDurableReferenceV6(
	value: unknown,
): OneRoundDurableUserReference | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"id",
			"sourceSessionId",
			"state",
			"misses",
			"kind",
			"authority",
			"semanticNote",
		]) ||
		typeof value.id !== "string" ||
		(value.sourceSessionId !== undefined &&
			typeof value.sourceSessionId !== "string") ||
		(value.state !== "active" && value.state !== "cooling") ||
		!isFiniteNonNegativeInteger(value.misses) ||
		(value.kind !== undefined &&
			![
				"plan",
				"spec",
				"requirements",
				"correction",
				"log",
				"evidence",
				"other",
			].includes(value.kind as string)) ||
		(value.authority !== undefined &&
			value.authority !== "governing" &&
			value.authority !== "supporting") ||
		(value.semanticNote !== undefined && typeof value.semanticNote !== "string")
	)
		return undefined;
	return {
		id: value.id,
		...(typeof value.sourceSessionId === "string"
			? { sourceSessionId: value.sourceSessionId }
			: {}),
		state: value.state,
		misses: value.misses,
		...(typeof value.kind === "string"
			? {
					kind: value.kind as NonNullable<OneRoundDurableUserReference["kind"]>,
				}
			: {}),
		...(typeof value.authority === "string"
			? {
					authority: value.authority as NonNullable<
						OneRoundDurableUserReference["authority"]
					>,
				}
			: {}),
		...(typeof value.semanticNote === "string"
			? { semanticNote: value.semanticNote }
			: {}),
	};
}

export function parseOneRoundDurableReferencesV6(
	value: unknown,
): OneRoundDurableUserReference[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const references: OneRoundDurableUserReference[] = [];
	for (const item of value) {
		const reference = parseOneRoundDurableReferenceV6(item);
		if (reference === undefined) return undefined;
		references.push(reference);
	}
	return references;
}

export function parseOneRoundUserArtifactLocators(
	value: unknown,
): OneRoundUserArtifactLocator[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const locators: OneRoundUserArtifactLocator[] = [];
	for (const item of value) {
		if (
			!isRecord(item) ||
			!hasOnlyKeys(item, ["id", "sourceSessionId"]) ||
			typeof item.id !== "string" ||
			(item.sourceSessionId !== undefined &&
				typeof item.sourceSessionId !== "string")
		)
			return undefined;
		locators.push({
			id: item.id,
			...(typeof item.sourceSessionId === "string"
				? { sourceSessionId: item.sourceSessionId }
				: {}),
		});
	}
	return locators;
}

export function parseOneRoundRenderBudgets(
	value: unknown,
): OneRoundRenderBudgets | undefined {
	if (!isRecord(value)) return undefined;
	const intentWorkflowChars = value.intentWorkflowChars;
	const gitStateChars = value.gitStateChars;
	const editedFilesChars = value.editedFilesChars;
	const readFilesChars = value.readFilesChars;
	const userMessagesChars = value.userMessagesChars;
	const userArtifactReferencesChars = value.userArtifactReferencesChars;
	if (
		!hasOnlyKeys(value, [
			"intentWorkflowChars",
			"gitStateChars",
			"editedFilesChars",
			"readFilesChars",
			"userMessagesChars",
			"userArtifactReferencesChars",
		]) ||
		!isFiniteNonNegativeInteger(intentWorkflowChars) ||
		!isFiniteNonNegativeInteger(gitStateChars) ||
		!isFiniteNonNegativeInteger(editedFilesChars) ||
		!isFiniteNonNegativeInteger(readFilesChars) ||
		!isFiniteNonNegativeInteger(userMessagesChars) ||
		!isFiniteNonNegativeInteger(userArtifactReferencesChars)
	) {
		return undefined;
	}
	return {
		intentWorkflowChars,
		gitStateChars,
		editedFilesChars,
		readFilesChars,
		userMessagesChars,
		userArtifactReferencesChars,
	};
}

export function parseOneRoundRenderBudgetsV6(
	value: unknown,
): OneRoundRenderBudgetsV6 | undefined {
	if (!isRecord(value)) return undefined;
	const keys = [
		"gitStateChars",
		"editedFilesChars",
		"readFilesChars",
		"userMessagesChars",
		"userArtifactReferencesChars",
	] as const;
	if (
		!hasOnlyKeys(value, keys) ||
		keys.some((key) => !isFiniteNonNegativeInteger(value[key]))
	)
		return undefined;
	return {
		gitStateChars: value.gitStateChars as number,
		editedFilesChars: value.editedFilesChars as number,
		readFilesChars: value.readFilesChars as number,
		userMessagesChars: value.userMessagesChars as number,
		userArtifactReferencesChars: value.userArtifactReferencesChars as number,
	};
}

export function parseOneRoundGit(value: unknown): OneRoundGit | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, ["root", "branch", "head", "dirty", "truncated"]) ||
		typeof value.root !== "string" ||
		typeof value.branch !== "string" ||
		typeof value.head !== "string" ||
		!isStringArray(value.dirty) ||
		typeof value.truncated !== "boolean"
	) {
		return undefined;
	}
	return {
		root: value.root,
		branch: value.branch,
		head: value.head,
		dirty: value.dirty,
		truncated: value.truncated,
	};
}

export function parseOneRoundIntentWorkflow(
	value: unknown,
): OneRoundIntentWorkflow | undefined {
	if (
		!isRecord(value) ||
		!hasOnlyKeys(value, [
			"active",
			"workstream",
			"hasPlan",
			"intentTruncated",
			"planTruncated",
		]) ||
		typeof value.active !== "boolean" ||
		(value.workstream !== undefined && typeof value.workstream !== "string") ||
		(value.hasPlan !== undefined && typeof value.hasPlan !== "boolean") ||
		(value.intentTruncated !== undefined &&
			typeof value.intentTruncated !== "boolean") ||
		(value.planTruncated !== undefined &&
			typeof value.planTruncated !== "boolean")
	) {
		return undefined;
	}
	if (
		value.active &&
		(typeof value.workstream !== "string" || typeof value.hasPlan !== "boolean")
	)
		return undefined;
	return {
		active: value.active,
		...(typeof value.workstream === "string"
			? { workstream: value.workstream }
			: {}),
		...(typeof value.hasPlan === "boolean" ? { hasPlan: value.hasPlan } : {}),
		...(typeof value.intentTruncated === "boolean"
			? { intentTruncated: value.intentTruncated }
			: {}),
		...(typeof value.planTruncated === "boolean"
			? { planTruncated: value.planTruncated }
			: {}),
	};
}
