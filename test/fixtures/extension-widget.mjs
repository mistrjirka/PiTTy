/**
 * Command-only fixture for the real extension-widget RPC test.
 * It imports no provider and never requests an assistant response.
 */
export default function (pi) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setWidget("fixture-above", [
      "\x1b[1;32mBuild status\x1b[0m",
      "Plain **text** remains literal.",
    ]);
    ctx.ui.setWidget("fixture-below", ["Below editor status"], {
      placement: "belowEditor",
    });
  });

  pi.registerCommand("widget-fixture-update", {
    description: "Update and move one widget, then remove the other.",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("fixture-above", [
        "\x1b[38;2;34;211;238mUpdated status\x1b[0m",
        "Second line",
      ], { placement: "belowEditor" });
      ctx.ui.setWidget("fixture-below", undefined);
    },
  });

  pi.registerCommand("widget-fixture-clear", {
    description: "Remove the remaining widget.",
    handler: async (_args, ctx) => {
      ctx.ui.setWidget("fixture-above", undefined);
    },
  });

  // Commands run before this hook. If a test sends another prompt by mistake,
  // consume it before model validation or execution and make the mistake visible.
  pi.on("input", (_event, ctx) => {
    ctx.ui.notify("Unexpected non-command input in widget RPC fixture", "error");
    return { action: "handled" };
  });
}
