#!/usr/bin/env bun
/**
 * Render the production prompt dock with synthetic extension data.
 *
 * Run from the repository root:
 *   bun --conditions=browser scripts/extension-widget-preview.tsx [output-directory]
 *
 * These are actual OpenTUI cell captures, rasterized with a local monospace font.
 * They are not desktop screenshots. No Pi process or model request is started.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ScrollBoxRenderable,
  TextAttributes,
  type CapturedFrame,
  type Renderable,
  type TextareaRenderable,
} from "@opentui/core";
import { testRender } from "@opentui/solid";
import type { ExtensionTextWidget } from "../src/state/extension-widgets.ts";
import { AppPromptDock } from "../src/ui/app-prompt-dock.tsx";
import { PromptComposer } from "../src/ui/prompt-composer.tsx";
import { AppFooter } from "../src/ui/app-footer.tsx";
import { colors } from "../src/ui/theme.ts";

const outputDir = resolve(process.argv[2] ?? join(import.meta.dir, "..", "docs", "screenshots"));
const isolatedRoot = mkdtempSync(join(tmpdir(), "pitty-extension-widget-preview-"));
const previousProfiledRoot = process.env.PI_PITTY_PROFILED_ROOT;
process.env.PI_PITTY_PROFILED_ROOT = isolatedRoot;
const { MessageView } = await import("../src/ui/message.tsx");
const { registerBundledParsers } = await import("../src/ui/parsers.ts");
registerBundledParsers();

const green = "\x1b[1;38;2;74;222;128m";
const cyan = "\x1b[38;2;34;211;238m";
const reset = "\x1b[0m";
const draft = "Continue with the next step.";
const footerText = "Preview ready";

type Scenario = {
  name: string;
  label: string;
  width: number;
  height: number;
  widgets: ExtensionTextWidget[];
  expected: string[];
  scroll?: boolean;
};

const below: ExtensionTextWidget = {
  key: "preview-below",
  placement: "belowEditor",
  lines: ["\x1b[2mExtension text below the editor.\x1b[0m"],
};
const scenarios: Scenario[] = [
  {
    name: "extension-widgets",
    label: "Text widgets above and below the editor",
    width: 100,
    height: 30,
    widgets: [
      {
        key: "preview-build",
        placement: "aboveEditor",
        lines: [
          green + "Build status" + reset,
          "Typecheck complete. Test suite running.",
        ],
      },
      {
        key: "preview-answer",
        placement: "aboveEditor",
        lines: [
          cyan + "Sample side answer" + reset,
          "This extension text stays separate from the conversation.",
        ],
      },
      below,
    ],
    expected: ["Build status", "Sample side answer", "Extension text below"],
  },
  {
    name: "extension-widgets-narrow",
    label: "Narrow terminal with a wrapped extension answer",
    width: 64,
    height: 22,
    widgets: [
      {
        key: "preview-answer",
        placement: "aboveEditor",
        lines: [
          cyan + "Sample side answer" + reset,
          "A widget can show a longer explanation while you keep writing. Its text wraps to the available width. The editor remains available below it.",
          green + "Build status" + reset + "  Tests running.",
        ],
      },
      below,
    ],
    expected: ["Sample side answer", "longer explanation", "remains available below it.", "Build status", "Extension text below"],
  },
  {
    name: "extension-widgets-overflow",
    label: "Long widget in a bounded scroll region",
    width: 64,
    height: 22,
    widgets: [
      {
        key: "preview-log",
        placement: "aboveEditor",
        lines: [
          green + "Build progress" + reset,
          ...Array.from({ length: 20 }, (_, index) =>
            "Example log line " + String(index + 1).padStart(2, "0") + ": checking a build step."),
          cyan + "End of sample widget" + reset,
        ],
      },
      below,
    ],
    expected: ["Build progress", "Example log line 01", "Extension text below"],
    scroll: true,
  },
];

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rgb(value: readonly number[]): string {
  return "rgb(" + value.slice(0, 3).join(",") + ")";
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function captureSvg(frame: CapturedFrame, label: string): string {
  const cellWidth = 9.6;
  const cellHeight = 20;
  const padding = 20;
  const top = 72;
  const width = frame.cols * cellWidth + padding * 2;
  const height = frame.rows * cellHeight + top + padding;
  const markup: string[] = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height + '">',
    "<title>" + escapeXml(label) + "</title>",
    "<desc>Actual OpenTUI production component cells with synthetic data. Text and colors come from captureSpans. This is not a desktop screenshot.</desc>",
    '<rect width="100%" height="100%" fill="#09090b"/>',
    '<text x="20" y="26" fill="#fafafa" font-family="sans-serif" font-size="16" font-weight="600">' + escapeXml(label) + "</text>",
    '<text x="20" y="49" fill="#a1a1aa" font-family="sans-serif" font-size="12">Actual OpenTUI cells · synthetic fixture · ' + frame.cols + " × " + frame.rows + "</text>",
    '<g font-family="Adwaita Mono,DejaVu Sans Mono,monospace" font-size="15" font-variant-ligatures="none" xml:space="preserve">',
  ];
  for (const [row, line] of frame.lines.entries()) {
    let column = 0;
    for (const span of line.spans) {
      const x = padding + column * cellWidth;
      const y = top + row * cellHeight;
      const spanWidth = span.width * cellWidth;
      let fg = span.fg.toInts();
      let bg = span.bg.toInts();
      if (span.attributes & TextAttributes.INVERSE) [fg, bg] = [bg, fg];
      if (bg[3] > 0) {
        markup.push('<rect x="' + x + '" y="' + y + '" width="' + spanWidth + '" height="' + cellHeight + '" fill="' + rgb(bg) + '" fill-opacity="' + bg[3] / 255 + '"/>');
      }
      if (span.text.trim() && !(span.attributes & TextAttributes.HIDDEN)) {
        const style: string[] = [];
        if (span.attributes & TextAttributes.BOLD) style.push('font-weight="700"');
        if (span.attributes & TextAttributes.ITALIC) style.push('font-style="italic"');
        const decorations: string[] = [];
        if (span.attributes & TextAttributes.UNDERLINE) decorations.push("underline");
        if (span.attributes & TextAttributes.STRIKETHROUGH) decorations.push("line-through");
        if (decorations.length) style.push('text-decoration="' + decorations.join(" ") + '"');
        const opacity = (fg[3] / 255) * (span.attributes & TextAttributes.DIM ? 0.6 : 1);
        // Explicit cell positions also work in rasterizers that ignore SVG textLength.
        const glyphs: string[] = [];
        let glyphColumn = 0;
        for (const { segment } of graphemes.segment(span.text)) {
          if (segment.trim()) glyphs.push('<tspan x="' + (x + glyphColumn * cellWidth) + '" y="' + (y + 15) + '">' + escapeXml(segment) + "</tspan>");
          glyphColumn += Bun.stringWidth(segment);
        }
        markup.push('<text fill="' + rgb(fg) + '" fill-opacity="' + opacity + '" ' + style.join(" ") + ">" + glyphs.join("") + "</text>");
      }
      column += span.width;
    }
  }
  markup.push("</g></svg>");
  return markup.join("\n");
}

function scrollBoxes(node: Renderable): ScrollBoxRenderable[] {
  return [
    ...(node instanceof ScrollBoxRenderable ? [node] : []),
    ...node.getChildren().flatMap((child) => scrollBoxes(child)),
  ];
}

function writeCapture(name: string, label: string, frame: CapturedFrame, text: string): void {
  const svgPath = join(outputDir, name + ".svg");
  const pngPath = join(outputDir, name + ".png");
  writeFileSync(svgPath, captureSvg(frame, label));
  writeFileSync(join(outputDir, name + ".txt"), text.replace(/[ \t]+$/gm, "").trimEnd() + "\n");
  const result = spawnSync("rsvg-convert", ["-o", pngPath, svgPath], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error("PNG conversion failed: " + (result.error?.message ?? result.stderr));
  }
  console.log(name + ": " + frame.cols + "x" + frame.rows + " cells -> " + pngPath);
}

try {
  mkdirSync(outputDir, { recursive: true });
  for (const scenario of scenarios) {
    let editor: TextareaRenderable | undefined;
    const setup = await testRender(() => (
      <box width="100%" height="100%" flexDirection="column" backgroundColor={colors.background}>
        <box flexGrow={1} minHeight={1} paddingLeft={2} paddingRight={2} flexDirection="column" overflow="hidden">
          <MessageView
            item={{ kind: "user", id: "preview-user", text: "Show build progress near the editor.", timestamp: 0, optimistic: false }}
            showThinking={false}
            toolExpanded={false}
          />
          <MessageView
            item={{ kind: "assistant", id: "preview-assistant", text: "The extension panel can update while you write your next message.", thinking: "", timestamp: 0, status: "done" }}
            showThinking={false}
            toolExpanded={false}
          />
        </box>
        <AppPromptDock
          viewportRows={() => scenario.height}
          enabled={() => true}
          extensionWidgets={() => scenario.widgets}
          queuedFollowUps={() => []}
          steeringQueue={() => []}
          followUpQueue={() => []}
          editQueuedFollowUp={() => {}}
          commandSuggestions={() => []}
          commandSuggestionIndex={() => 0}
          insertSuggestedCommand={() => {}}
        >
          <PromptComposer
            streaming={() => false}
            focused={() => true}
            placeholder={() => "Ask Pi anything… (/help for commands)"}
            onEditor={(value) => { editor = value; }}
            onPaste={() => {}}
            onKeyDown={() => {}}
            onMouseDown={() => {}}
            onContentChange={() => {}}
            onCursorChange={() => {}}
            onSubmit={() => {}}
          />
        </AppPromptDock>
        <AppFooter
          streaming={() => false}
          statusText={() => footerText}
          segments={() => []}
          hintText={() => "ctrl+p models"}
        />
      </box>
    ), { width: scenario.width, height: scenario.height, useMouse: true, enableMouseMovement: true });
    try {
      await setup.flush();
      await setup.mockInput.typeText(draft);
      await setup.waitForVisualIdle({ quietFrames: 2, maxFrames: 120 });
      for (const scroll of scrollBoxes(setup.renderer.root)) scroll.scrollTo(0);
      await setup.flush();
      const frame = setup.captureCharFrame();
      console.log(JSON.stringify({ scenario: scenario.name, editor: editor ? { x: editor.x, y: editor.y, width: editor.width, height: editor.height } : null, composer: editor?.parent ? { y: editor.parent.y, height: editor.parent.height } : null, footerY: frame.split("\n").findIndex((line) => line.includes(footerText)), widgets: scrollBoxes(setup.renderer.root).map((box) => ({ id: box.id, y: box.y, height: box.height, content: box.scrollHeight })) }));
      assert.equal(editor?.plainText, draft);
      assert.equal(setup.renderer.currentFocusedEditor, editor);
      for (const expected of [...scenario.expected, draft, footerText]) assert.ok(frame.includes(expected), scenario.name + " missing " + expected + "\n" + frame);
      writeCapture(scenario.name, scenario.label, setup.captureSpans(), frame);
      if (scenario.scroll) {
        const scroll = scrollBoxes(setup.renderer.root).find((box) => box.scrollHeight > box.height);
        assert.ok(scroll, "Long widget must have a scrolling region");
        scroll.scrollTo(scroll.scrollHeight);
        await setup.flush();
        const scrolled = setup.captureCharFrame();
        assert.ok(scrolled.includes("End of sample widget"));
        assert.ok(scrolled.includes(draft));
        assert.ok(scrolled.includes(footerText));
        assert.equal(setup.renderer.currentFocusedEditor, editor);
        writeCapture(scenario.name + "-scrolled", "Long widget after scrolling; editor keeps focus", setup.captureSpans(), scrolled);
      }
    } finally {
      await setup.dispose();
    }
  }
} finally {
  if (previousProfiledRoot === undefined) delete process.env.PI_PITTY_PROFILED_ROOT;
  else process.env.PI_PITTY_PROFILED_ROOT = previousProfiledRoot;
  rmSync(isolatedRoot, { recursive: true, force: true });
}
