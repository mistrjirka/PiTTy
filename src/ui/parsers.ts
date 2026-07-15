import { addDefaultParsers, type FiletypeParserOptions } from "@opentui/core";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let registered = false;

/** Register the parsers bundled with @opentui/core for markdown and common code fences. */
export function registerBundledParsers(): void {
  if (registered) return;
  registered = true;

  const coreEntry = fileURLToPath(import.meta.resolve("@opentui/core"));
  const assets = path.join(path.dirname(coreEntry), "assets");
  const file = (...parts: string[]) => path.join(assets, ...parts);

  const parsers: FiletypeParserOptions[] = [
    {
      filetype: "javascript",
      aliases: ["javascriptreact"],
      wasm: file("javascript", "tree-sitter-javascript.wasm"),
      queries: { highlights: [file("javascript", "highlights.scm")] },
    },
    {
      filetype: "typescript",
      aliases: ["typescriptreact"],
      wasm: file("typescript", "tree-sitter-typescript.wasm"),
      queries: { highlights: [file("typescript", "highlights.scm")] },
    },
    {
      filetype: "markdown",
      wasm: file("markdown", "tree-sitter-markdown.wasm"),
      queries: {
        highlights: [file("markdown", "highlights.scm")],
        injections: [file("markdown", "injections.scm")],
      },
      injectionMapping: {
        nodeTypes: { inline: "markdown_inline", pipe_table_cell: "markdown_inline" },
        infoStringMap: {
          javascript: "javascript",
          js: "javascript",
          jsx: "javascriptreact",
          javascriptreact: "javascriptreact",
          typescript: "typescript",
          ts: "typescript",
          tsx: "typescriptreact",
          typescriptreact: "typescriptreact",
          markdown: "markdown",
          md: "markdown",
        },
      },
    },
    {
      filetype: "markdown_inline",
      wasm: file("markdown_inline", "tree-sitter-markdown_inline.wasm"),
      queries: { highlights: [file("markdown_inline", "highlights.scm")] },
    },
  ];

  addDefaultParsers(parsers);
}
