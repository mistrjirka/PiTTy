import { describe, expect, test } from "bun:test";
import { filterSessionChoices, mapSessionInfo, prepareSessionChoices } from "../src/sessions.ts";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

const info = (path: string, modified: string, name?: string, id = path, firstMessage = "Initial request"): SessionInfo => ({ path, id, cwd: "/tmp/project", ...(name ? { name } : {}), created: new Date(modified), modified: new Date(modified), messageCount: 2, firstMessage, allMessagesText: firstMessage });

describe("session choices", () => {
  test("maps, excludes active, and sorts recent first", () => {
    const result = prepareSessionChoices([info("old", "2020-01-01"), info("new", "2024-01-01", "Named")], "old");
    expect(result.map((choice) => choice.path)).toEqual(["new"]);
    expect(mapSessionInfo(info("x", "2024-01-01")).name).toBe("Initial request");
  });
  test("filters name, id, and first message independently", () => {
    const choices = prepareSessionChoices([
      info("name-path", "2024-01-01", "Planning notes", "name-id", "Discuss release"),
      info("id-path", "2024-01-02", "Unrelated", "distinct-session-id", "Another request"),
      info("message-path", "2024-01-03", "Other", "message-id", "Investigate parser"),
    ]);
    expect(filterSessionChoices(choices, "planning").map((choice) => choice.id)).toEqual(["name-id"]);
    expect(filterSessionChoices(choices, "distinct-session-id").map((choice) => choice.id)).toEqual(["distinct-session-id"]);
    expect(filterSessionChoices(choices, "investigate parser").map((choice) => choice.id)).toEqual(["message-id"]);
    expect(filterSessionChoices(choices, "zzz")).toHaveLength(0);
  });
});
