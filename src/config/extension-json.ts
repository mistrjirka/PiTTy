/** Shared JSON parsing and atomic writes for Pi extension settings. */
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { isMissing } from "./extension-profile-discovery.ts";

export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}


function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

export async function writeJsonObject(
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

export async function readOptionalJson(filePath: string): Promise<JsonObject> {
	return (await readJsonObject(filePath)).value;
}
