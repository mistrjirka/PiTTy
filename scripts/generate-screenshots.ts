#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const outputDir = join(import.meta.dir, "..", "docs", "screenshots");
const states: Record<string, string> = {
	conversation: "\x1b[1;36mPiTTy\x1b[0m  conversation\n\n\x1b[32mYou\x1b[0m  Review the latest changes\n\x1b[37mAssistant\x1b[0m  I checked the implementation and found no blockers.\n\x1b[2m  thinking (collapsed)\x1b[0m\n\n\x1b[33m▣ TOOL · bash\x1b[0m  echo ready\n  ready\n\x1b[35m◇ TOOL · reviewer · gpt-5.6-luna · background · ✓ completed · took 2s\x1b[0m\n  Check the tabs and workflow wiring\n\n\x1b[35mSupervisor\x1b[0m  Should I continue with the next task?",
	tabs: "\x1b[1;36m[ main ]  [\x1b[1;33m● review\x1b[0m\x1b[1;36m ]  [ logs ]\x1b[0m\n\nTranscript\n  The review tab is active.\n  Changes are ready for inspection.",
	"fork-picker": "\x1b[1;36mFork conversation\x1b[0m\n\n  ▸ Continue from latest answer\n    Fork from user prompt\n    Fork from tool result\n    Start a fresh branch\n\n  Enter select   Esc cancel",
};

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ansiToHtml(value: string): string {
	let html = "";
	let color = "";
	for (const part of value.split(/(\x1b\[[0-9;]*m)/g)) {
		const match = /^\x1b\[([0-9;]*)m$/.exec(part);
		if (match) {
			const codes = match[1]!.split(";");
			if (codes.includes("0")) color = "";
			else if (codes.includes("31")) color = "red";
			else if (codes.includes("32")) color = "green";
			else if (codes.includes("33")) color = "yellow";
			else if (codes.includes("35")) color = "magenta";
			else if (codes.includes("36")) color = "cyan";
			else if (codes.includes("37")) color = "white";
			else if (codes.includes("2")) color = "dim";
			continue;
		}
		html += color ? `<span class="${color}">${escapeHtml(part)}</span>` : escapeHtml(part);
	}
	return html;
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function ansiToSvg(value: string): string {
	const lines = value.split("\n");
	while (lines.length > 0 && lines.at(-1)!.trim() === "") lines.pop();
	const runsByLine: Array<Array<{ text: string; color: string }>> = [];
	let maxLineCols = 0;
	for (const line of lines) {
		let color = "";
		const runs: Array<{ text: string; color: string }> = [];
		for (const part of line.split(/(\x1b\[[0-9;]*m)/g)) {
			const match = /^\x1b\[([0-9;]*)m$/.exec(part);
			if (match) {
				const codes = match[1]!.split(";");
				if (codes.includes("0")) color = "";
				else if (codes.includes("31")) color = "red";
				else if (codes.includes("32")) color = "green";
				else if (codes.includes("33")) color = "yellow";
				else if (codes.includes("35")) color = "magenta";
				else if (codes.includes("36")) color = "cyan";
				else if (codes.includes("37")) color = "white";
				else if (codes.includes("2")) color = "dim";
				continue;
			}
			if (part !== "") runs.push({ text: part, color });
		}
		maxLineCols = Math.max(maxLineCols, [...runs.map((run) => run.text).join("")].length);
		runsByLine.push(runs);
	}
	const charWidth = 8.4;
	const lineHeight = 19;
	const padding = 12;
	const width = Math.ceil(maxLineCols * charWidth + padding * 2);
	const height = lines.length * lineHeight + padding * 2;
	const body = runsByLine.map((runs, index) => {
		const tspans = runs.map((run) => `<tspan${run.color ? ` class=\"${run.color}\"` : ""}>${escapeXml(run.text)}</tspan>`).join("");
		return `<text x=\"${padding}\" y=\"${padding + 14 + index * lineHeight}\">${tspans}</text>`;
	}).join("\n");
	return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" role=\"img\" aria-label=\"PiTTy ${escapeXml("terminal preview")}\" xml:space=\"preserve\">\n<rect width=\"100%\" height=\"100%\" fill=\"#10131a\"/>\n<metadata>PiTTy terminal preview rendered from an ANSI capture using the SGR palette. This image is self-contained for README embedding.</metadata>\n<desc>Deterministic terminal UI preview with monospace text and ANSI colors.</desc>\n<style>text{font-family:monospace;font-size:14px;white-space:pre;fill:#d8dee9}.red{fill:#ff6b6b}.green{fill:#8bd49c}.yellow{fill:#f2c879}.magenta{fill:#d7a5ff}.cyan{fill:#7bdff2}.white{fill:#fff}.dim{fill:#748096}</style>\n${body}\n</svg>\n`;
}

mkdirSync(outputDir, { recursive: true });
const tmuxCheck = spawnSync("tmux", ["-V"], { encoding: "utf8" });
if (tmuxCheck.error || tmuxCheck.status !== 0) {
	console.error("tmux is required to generate screenshots; install tmux and retry.");
	process.exit(1);
}

for (const [name, fixture] of Object.entries(states)) {
	const session = `pitty-screenshots-${process.pid}-${name}`;
	const socket = `pitty-shot-${process.pid}-${name}`;
	const encoded = Buffer.from(fixture).toString("base64");
	const started = spawnSync("tmux", ["-L", socket, "new-session", "-d", "-x", "100", "-y", "30", "-s", session, "sh", "-c", `printf %s ${encoded} | base64 -d; sleep 1`], { encoding: "utf8" });
	if (started.status !== 0) throw new Error(`unable to start tmux fixture for ${name}: ${started.stderr}`);
	spawnSync("sleep", ["0.1"]);
	const captured = spawnSync("tmux", ["-L", socket, "capture-pane", "-e", "-p", "-S", "-30", "-t", session], { encoding: "utf8" });
	spawnSync("tmux", ["-L", socket, "kill-session", "-t", session]);
	if (captured.status !== 0) throw new Error(`unable to capture ${name}: ${captured.stderr}`);
	const ansi = captured.stdout.trimEnd() + "\n";
	writeFileSync(join(outputDir, `${name}.ansi`), ansi);
	writeFileSync(join(outputDir, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>PiTTy ${name}</title><style>body{background:#10131a;color:#d8dee9}pre{font:14px monospace;line-height:1.35}.red{color:#ff6b6b}.green{color:#8bd49c}.yellow{color:#f2c879}.magenta{color:#d7a5ff}.cyan{color:#7bdff2}.white{color:#fff}.dim{color:#748096}</style><pre>${ansiToHtml(ansi)}</pre>`);
	writeFileSync(join(outputDir, `${name}.svg`), ansiToSvg(ansi));
}
console.log(`Generated ${Object.keys(states).length} deterministic previews in ${outputDir}`);
