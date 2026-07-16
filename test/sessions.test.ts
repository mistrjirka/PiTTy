import { describe, expect, test } from "bun:test";
import { filterSessionChoices, mapSessionInfo, prepareSessionChoices } from "../src/sessions.ts";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

const info = (path: string, modified: string, name?: string): SessionInfo => ({ path, id: path, cwd: "/tmp/project", ...(name ? { name } : {}), created: new Date(modified), modified: new Date(modified), messageCount: 2, firstMessage: "Initial request", allMessagesText: "Initial request" });

describe("session choices", () => {
  test("maps, excludes active, and sorts recent first", () => {
    const result = prepareSessionChoices([info("old", "2020-01-01"), info("new", "2024-01-01", "Named")], "old");
    expect(result.map((choice) => choice.path)).toEqual(["new"]);
    expect(mapSessionInfo(info("x", "2024-01-01")).name).toBe("Initial request");
  });
  test("filters name, id, and first message", () => {
    const choices = prepareSessionChoices([info("abc", "2024-01-01", "Planning")]);
    expect(filterSessionChoices(choices, "plan")).toHaveLength(1);
    expect(filterSessionChoices(choices, "zzz")).toHaveLength(0);
  });
});
