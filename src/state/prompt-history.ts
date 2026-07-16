/** Session-local submitted prompt recovery. Entries are kept in oldest-to-newest order. */
export const PROMPT_HISTORY_LIMIT = 100;

export type PromptHistoryDirection = "older" | "newer";

export type PromptHistoryBrowseResult = {
  handled: boolean;
  text?: string;
};

export class PromptHistory {
  private readonly entries: string[] = [];
  private cursor: number | undefined;

  recordSubmitted(text: string): void {
    this.add(text.trim());
  }

  recordDraft(text: string): void {
    this.add(text);
  }

  private add(value: string): void {
    if (!value) return;
    if (this.entries.at(-1) === value) {
      this.cursor = undefined;
      return;
    }
    this.entries.push(value);
    if (this.entries.length > PROMPT_HISTORY_LIMIT) this.entries.shift();
    this.cursor = undefined;
  }

  reset(): void {
    this.cursor = undefined;
  }

  browse(currentText: string, direction: PromptHistoryDirection): PromptHistoryBrowseResult {
    if (currentText.includes("\n")) {
      this.reset();
      return { handled: false };
    }
    if (!this.entries.length) return { handled: false };
    if (this.cursor === undefined) {
      if (currentText !== "") return { handled: false };
      this.cursor = direction === "older" ? this.entries.length - 1 : this.entries.length;
    } else {
      this.cursor += direction === "older" ? -1 : 1;
    }
    if (this.cursor < 0) this.cursor = 0;
    if (this.cursor >= this.entries.length) {
      this.cursor = this.entries.length;
      return { handled: true, text: "" };
    }
    return { handled: true, text: this.entries[this.cursor]! };
  }

  noteEditorChange(text: string): void {
    if (this.cursor === undefined) return;
    const recovered = this.cursor < this.entries.length ? this.entries[this.cursor] : "";
    if (text !== recovered) this.reset();
  }

  get size(): number {
    return this.entries.length;
  }

  get values(): readonly string[] {
    return this.entries;
  }
}

export type CtrlCRecoveryInput = {
  draft: string;
  hasCopyableSelection: boolean;
};

export function shouldRecoverPromptDraft(input: CtrlCRecoveryInput): boolean {
  return !input.hasCopyableSelection && input.draft.length > 0;
}
