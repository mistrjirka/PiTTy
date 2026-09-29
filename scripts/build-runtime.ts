import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/index.tsx", "src/preload.ts", "src/upgrade.ts"],
  target: "bun",
  packages: "external",
  outdir: "dist",
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await Bun.write("dist/.pitty-runtime-build-v1", "opentui-solid-plugin-v1\n");
