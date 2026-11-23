import { expect, test } from "bun:test";
import { createSignal } from "solid-js";
import { AppFooter } from "../src/ui/app-footer.tsx";
import { Sidebar } from "../src/ui/sidebar.tsx";
import type { RpcSessionState } from "../src/types.ts";
import { mount } from "./render-helpers/mount.tsx";
import { useRenderTestEnv } from "./render-helpers/test-env.ts";

useRenderTestEnv();

test("the footer keeps the current thinking effort visible as it changes", async () => {
  const [thinkingLevel, setThinkingLevel] = createSignal<string | undefined>("high");
  const setup = await mount(() => (
    <AppFooter streaming={() => false} statusText={() => "● ready"}
      thinkingLevel={thinkingLevel} segments={() => [{ text: "claude(home) 5h 15%", tone: "normal" }]}
      hintText={() => "ctrl+t effort"} />
  ), 100, 5);
  try {
    let frame = setup.captureCharFrame();
    expect(frame).toContain("● ready │ THINK HIGH │ claude(home) 5h 15%");
    setThinkingLevel("low");
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("● ready │ THINK LOW │ claude(home) 5h 15%");
    expect(frame).not.toContain("THINK HIGH");
    for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
  } finally { setup.renderer.destroy(); }
});

test("the sidebar distinguishes thinking effort from the model name", async () => {
  const setup = await mount(() => <Sidebar runs={[]} state={{
    thinkingLevel: "xhigh", model: { provider: "doppelclaude", id: "claude-opus-5-5" },
  } as RpcSessionState} />, 54, 26);
  try {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("THINK XHIGH");
    expect(frame).toContain("doppelclaude/claude-opus-5-5");
  } finally { setup.renderer.destroy(); }
});


test("the running PiTTy version stays at the right of the footer", async () => {
  const { footerVersionLabel } = await import("../src/ui/footer-hints.ts");
  for (const width of [55, 75, 100, 150]) {
    const setup = await mount(() => (
      <AppFooter streaming={() => true} statusText={() => "● working"}
        thinkingLevel={() => "medium"}
        segments={() => [{ text: "claude(home) 5h 15%", tone: "normal" }]}
        hintText={() => "ctrl+p model  ctrl+t effort  ctrl+x settings"} />
    ), width, 5);
    try {
      const line = setup.captureCharFrame().split("\n")[0]!;
      expect(line).toContain(footerVersionLabel);
      expect(line.indexOf(footerVersionLabel)).toBeGreaterThan(line.indexOf("● working"));
      expect(line.length).toBeLessThanOrEqual(width);
      expect(setup.renderer.root.findDescendantById("footer-version")).toBeDefined();
    } finally {
      setup.renderer.destroy();
    }
  }
});
