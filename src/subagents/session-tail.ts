import * as fs from "node:fs";

/**
 * Read only a bounded suffix of an append-only Pi JSONL session. Discard the
 * first and last partial line before parsing. The terminal's transcript must
 * not load hundreds of MiB just to show the newest messages.
 */
export function readSessionTail(filePath: string, maxBytes = 16 * 1024 * 1024): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Math.max(0, size - start));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytes).toString("utf8");
    if (start > 0) {
      const firstBoundary = text.indexOf("\n");
      text = firstBoundary >= 0 ? text.slice(firstBoundary + 1) : "";
    }
    if (text && !text.endsWith("\n")) {
      const lastBoundary = text.lastIndexOf("\n");
      // A complete JSONL file does not require a final newline. Keep that
      // record, but discard a torn row while its writer is still appending.
      try {
        JSON.parse(text.slice(lastBoundary + 1));
        text += "\n";
      } catch {
        text = lastBoundary >= 0 ? text.slice(0, lastBoundary + 1) : "";
      }
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}
