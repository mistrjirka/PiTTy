import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const hash = (content) => createHash("sha256").update(content).digest("hex");
export const packageSource = (entry) => typeof entry === "string" ? entry : entry?.source;

export function sourceIdentity(source, base = process.cwd()) {
  if (typeof source !== "string") return undefined;
  const npm = source.match(/^npm:((?:@[^/\s]+\/)?[^@\s]+)(?:@[^\s]+)?$/);
  if (npm) return "npm:" + npm[1];
  const git = /^(git:|https?:\/\/|ssh:\/\/)/.test(source) && source.replace(/^git:/, "").match(/^(?:(?:https?|ssh|git):\/\/(?:git@)?|git@)?github\.com[/:]([^/@\s]+)\/([^/@\s]+)(?:@[^\s]+)?\/?$/i);
  if (git) return "git:github.com/" + git[1].toLowerCase() + "/" + git[2].replace(/\.git$/, "").toLowerCase();
  return "local:" + path.resolve(base, source);
}

export function readSettings(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  let value;
  try { value = raw === undefined ? {} : JSON.parse(raw); }
  catch { throw new Error("Cannot parse " + file + ". No settings were changed."); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value.packages !== undefined && (!Array.isArray(value.packages) ||
        value.packages.some((entry) => typeof packageSource(entry) !== "string"))))
    throw new Error("Invalid package settings in " + file + ". No settings were changed.");
  return { value, raw };
}

export function mergeFoundersPackages(settings, catalog, base) {
  const packages = [...(settings.packages ?? [])];
  const changes = [];
  for (const entry of catalog) {
    const identity = sourceIdentity(entry.source, base);
    const aliases = new Set([identity, ...entry.replaces.map((source) => sourceIdentity(source, base))]);
    const matches = packages.map((value, index) => ({ value, index }))
      .filter(({ value }) => aliases.has(sourceIdentity(packageSource(value), base)));
    const preferred = matches.find(({ value }) => sourceIdentity(packageSource(value), base) === identity) ?? matches[0];
    const existing = preferred?.value;
    // Preserve explicit pins and resource filters for an existing owned package.
    const existingSource = packageSource(existing);
    const unpinnedRequiredVersion = entry.version && existingSource === "npm:" + entry.names[0];
    const source = existing && !unpinnedRequiredVersion && sourceIdentity(existingSource, base) === identity
      ? existingSource : entry.source;
    const replacement = existing && typeof existing === "object" ? { ...existing, source } : source;
    const oldSources = matches.map(({ value }) => packageSource(value));
    if (!matches.length) packages.push(replacement);
    else {
      const first = matches[0].index;
      const indexes = new Set(matches.map(({ index }) => index));
      const next = packages.filter((_, index) => !indexes.has(index));
      next.splice(first, 0, replacement);
      packages.splice(0, packages.length, ...next);
    }
    changes.push({ ...entry, source, oldSources, configured: oldSources.length === 1 && oldSources[0] === source });
  }
  return { settings: { ...settings, packages }, packages: changes };
}

export function atomicWrite(file, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".founders-" + randomUUID();
  try {
    fs.writeFileSync(temporary, content, { flag: "wx", mode });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function packageFile(root, relative) {
  if (typeof relative !== "string") throw new Error("Invalid bundle file path.");
  const file = path.resolve(root, relative);
  const inside = path.relative(root, file);
  if (!inside || inside === ".." || inside.startsWith(".." + path.sep) || path.isAbsolute(inside))
    throw new Error("Bundle file is outside its package: " + relative);
  // A symlink must not allow the manifest to read a file outside the bundle.
  const real = fs.realpathSync(file);
  const realInside = path.relative(fs.realpathSync(root), real);
  if (realInside === ".." || realInside.startsWith(".." + path.sep) || path.isAbsolute(realInside))
    throw new Error("Bundle symlink points outside its package: " + relative);
  return file;
}

export function planAgents(bundleRoot, agentDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.agents) || !manifest.agents.length ||
      !Array.isArray(manifest.skills) || !manifest.skills.length)
    throw new Error("Unsupported curated bundle manifest.");
  for (const skill of manifest.skills) {
    if (typeof skill?.path !== "string") throw new Error("Invalid curated skill path.");
    packageFile(bundleRoot, skill.path + "/SKILL.md");
  }
  const receiptFile = path.join(agentDir, "pitty-founders.json");
  let receipt = { schemaVersion: 1, agents: {} };
  if (fs.existsSync(receiptFile)) {
    receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    if (receipt.schemaVersion !== 1 || !receipt.agents || typeof receipt.agents !== "object" || Array.isArray(receipt.agents))
      throw new Error("Unsupported founders ownership receipt.");
  }
  const names = new Set();
  const agents = manifest.agents.map((entry) => {
    if (!entry || typeof entry.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name) ||
        names.has(entry.name) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? ""))
      throw new Error("Invalid or duplicate curated agent identity.");
    names.add(entry.name);
    const content = fs.readFileSync(packageFile(bundleRoot, entry.path), "utf8");
    if (hash(content) !== entry.sha256) throw new Error("Curated agent checksum mismatch: " + entry.name);
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!frontmatter || /^\s*(model|provider)\s*:/m.test(frontmatter))
      throw new Error("Curated agent must leave its model and provider unset: " + entry.name);
    const profileName = frontmatter.match(/^name:\s*([^\r\n]+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
    if (profileName !== entry.name) throw new Error("Curated agent name differs from its manifest: " + entry.name);
    const filename = entry.name + ".md";
    const destination = path.join(agentDir, "agents", filename);
    let current;
    let symlink = false;
    try {
      symlink = fs.lstatSync(destination).isSymbolicLink();
      current = fs.readFileSync(destination, "utf8");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const unchanged = current !== undefined && hash(current) === entry.sha256;
    const owned = !symlink && current !== undefined && hash(current) === receipt.agents[filename];
    const action = unchanged ? "present" : current === undefined && !symlink ? "install" : owned ? "update" : "preserve";
    return { name: entry.name, filename, destination, content, sha256: entry.sha256, action, current, symlink };
  });
  return { agents, receiptFile, receipt, skillCount: manifest.skills.length };
}

/** Write only missing or unchanged managed profiles. Never replace custom files. */
export function installAgents(plan) {
  const next = { ...plan.receipt, agents: { ...plan.receipt.agents } };
  for (const agent of plan.agents) {
    if (agent.action === "preserve") continue;
    if (agent.action === "install" || agent.action === "update") {
      let current;
      try { current = fs.readFileSync(agent.destination, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (current !== agent.current || (fs.existsSync(agent.destination) && fs.lstatSync(agent.destination).isSymbolicLink()))
        throw new Error("Agent changed during setup: " + agent.name + ". Run setup again.");
      atomicWrite(agent.destination, agent.content, 0o644);
    }
    if (!agent.symlink) next.agents[agent.filename] = agent.sha256;
  }
  const nextText = JSON.stringify(next, null, 2) + "\n";
  const previous = fs.existsSync(plan.receiptFile) ? fs.readFileSync(plan.receiptFile, "utf8") : undefined;
  if (previous !== nextText) atomicWrite(plan.receiptFile, nextText);
}
