/** A harmless process kept alive until the integration test releases its file gate. */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
appendFileSync(path.join(directory, "command-launches"), process.pid + "\n");
process.stdout.write("fixture command running\n");
writeFileSync(path.join(directory, "command-started"), String(process.pid));
const deadline = Date.now() + 20_000;
while (!existsSync(path.join(directory, "command-release"))) {
  if (Date.now() > deadline) throw new Error("Foreground command gate timed out.");
  await new Promise((resolve) => setTimeout(resolve, 10));
}
writeFileSync(path.join(directory, "command-completed"), String(process.pid));
