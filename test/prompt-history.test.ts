import { describe, expect, test } from "bun:test";
import { PromptHistory, PROMPT_HISTORY_LIMIT, shouldRecoverPromptDraft } from "../src/state/prompt-history.ts";

describe("PromptHistory", () => {
  test("records submitted text trimmed, suppresses adjacent duplicates, and bounds entries", () => {
    const history = new PromptHistory();
    for (let index = 0; index < PROMPT_HISTORY_LIMIT + 2; index += 1) history.recordSubmitted(`  prompt ${index}  `);
    history.recordSubmitted("prompt 101");
    history.recordSubmitted(" prompt 101 ");
    expect(history.size).toBe(PROMPT_HISTORY_LIMIT);
    expect(history.values[0]).toBe("prompt 2");
    expect(history.values.at(-1)).toBe("prompt 101");
  });

  test("browses older and newer entries, then clears past newest", () => {
    const history = new PromptHistory();
    history.recordSubmitted("one");
    history.recordSubmitted("two");
    expect(history.browse("", "older")).toEqual({ handled: true, text: "two" });
    expect(history.browse("two", "older")).toEqual({ handled: true, text: "one" });
    expect(history.browse("one", "newer")).toEqual({ handled: true, text: "two" });
    expect(history.browse("two", "newer")).toEqual({ handled: true, text: "" });
  });

  test("manual edits reset browsing and draft recovery preserves exact text", () => {
    const history = new PromptHistory();
    history.recordDraft(" draft  with spaces ");
    expect(history.browse("", "older").text).toBe(" draft  with spaces ");
    history.noteEditorChange("changed");
    expect(history.browse("changed", "older")).toEqual({ handled: false });
    expect(shouldRecoverPromptDraft({ draft: " draft ", hasCopyableSelection: false })).toBe(true);
    expect(shouldRecoverPromptDraft({ draft: "draft", hasCopyableSelection: true })).toBe(false);
  });

  test("multiline editor content leaves cursor navigation to textarea", () => {
    const history = new PromptHistory();
    history.recordSubmitted("one");
    expect(history.browse("line one\nline two", "older")).toEqual({ handled: false });
  });
});
