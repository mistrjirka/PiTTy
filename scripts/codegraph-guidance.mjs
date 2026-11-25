/** Narrow compatibility fix for the installed CodeGraph 0.1.11 prompt metadata. */
import fs from "node:fs";
import path from "node:path";

const NAME = "@vndv/pi-codegraph";
const VERSION = "0.1.11";
const MARKER = "// PiTTy: describe only tools active in this profile.";
const HOOK = '  pi.on("before_agent_start", async (event) => {';
const REDUNDANT = '      promptGuidelines: [\n        `${tool.name} is available for structural code questions backed by the local CodeGraph index.`,\n      ],';
const ROUTING = '      "Use codegraph_explore for broad flows, codegraph_search for symbol names, codegraph_files for project structure, codegraph_node for known symbols, and codegraph_callers for call relationships.",';
const ACTIVE_ROUTING = '      "Use the active CodeGraph tools for indexed symbols and relationships; their schemas describe the supported queries.",';
const ACTIVE_HOOK = `${HOOK}
    ${MARKER}
    if (typeof pi.getActiveTools === "function" && !pi.getActiveTools().some((name) => name.startsWith("codegraph_"))) return;`;

export function compactCodegraphGuidance(source) {
  if (source.includes(MARKER)) return { status: "current", source };
  // Refuse unfamiliar layouts rather than replace a user's routing policy.
  if (source.split(HOOK).length !== 2 || source.split(REDUNDANT).length !== 2 || source.split(ROUTING).length !== 2)
    return { status: "unrecognized", source };
  return {
    status: "needed",
    source: source.replace(HOOK, ACTIVE_HOOK).replace(REDUNDANT, "      promptGuidelines: [],").replace(ROUTING, ACTIVE_ROUTING),
  };
}

export function prepareCodegraphGuidance(directory, { dryRun = false } = {}) {
  if (!directory) return { status: "absent", changed: false };
  const metadataFile = path.join(directory, "package.json");
  const file = path.join(directory, "extensions", "codegraph.ts");
  if (!fs.existsSync(metadataFile) || !fs.existsSync(file)) return { status: "absent", changed: false };
  const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  if (metadata.name !== NAME || metadata.version !== VERSION || fs.lstatSync(file).isSymbolicLink())
    return { status: "unrecognized", changed: false };
  const result = compactCodegraphGuidance(fs.readFileSync(file, "utf8"));
  if (result.status !== "needed" || dryRun) return { status: result.status, changed: false };
  const temporary = file + ".pitty-" + process.pid + ".tmp";
  let created = false;
  try {
    const descriptor = fs.openSync(temporary, "wx", fs.statSync(file).mode & 0o777);
    created = true;
    try { fs.writeFileSync(descriptor, result.source); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { status: "updated", changed: true };
}
