/**
 * Side-by-side diff: the old file on the left, the new file on the right.
 * Removed and added runs inside a hunk are paired row by row, so a changed
 * line sits next to its replacement; the shorter run leaves its side empty.
 */
import { For, Show } from "solid-js";
import { diffLineColor } from "./message-format.tsx";
import { colors } from "./theme.ts";

export type SplitDiffSide = { line: number; text: string };
export type SplitDiffRow =
	| { kind: "hunk"; text: string }
	| { kind: "context"; left: SplitDiffSide; right: SplitDiffSide }
	| { kind: "change"; left?: SplitDiffSide; right?: SplitDiffSide };

/** Below this transcript width two halves are too narrow to read code. */
export const SPLIT_DIFF_MIN_WIDTH = 90;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function splitDiffRows(lines: readonly string[]): SplitDiffRow[] {
	const rows: SplitDiffRow[] = [];
	let oldLine = 1;
	let newLine = 1;
	let removed: SplitDiffSide[] = [];
	let added: SplitDiffSide[] = [];
	const flush = () => {
		for (let index = 0; index < Math.max(removed.length, added.length); index++) {
			const left = removed[index];
			const right = added[index];
			rows.push({ kind: "change", ...(left ? { left } : {}), ...(right ? { right } : {}) });
		}
		removed = [];
		added = [];
	};
	for (const line of lines) {
		// File headers repeat the path the card already shows.
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ") || line.startsWith("Index:") || line.startsWith("===")) continue;
		const hunk = HUNK.exec(line);
		if (hunk) {
			flush();
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[2]);
			rows.push({ kind: "hunk", text: line });
		} else if (line.startsWith("-")) {
			removed.push({ line: oldLine++, text: line.slice(1) });
		} else if (line.startsWith("+")) {
			added.push({ line: newLine++, text: line.slice(1) });
		} else if (line.startsWith("\\")) {
			// `\ No newline at end of file` describes the line above it.
			continue;
		} else {
			flush();
			const text = line.startsWith(" ") ? line.slice(1) : line;
			rows.push({
				kind: "context",
				left: { line: oldLine++, text },
				right: { line: newLine++, text },
			});
		}
	}
	flush();
	return rows;
}

function SplitDiffHalf(props: {
	side: SplitDiffSide | undefined;
	sign: "-" | "+" | " ";
	gutter: number;
}) {
	const color = () =>
		props.sign === "-" ? colors.red : props.sign === "+" ? colors.green : colors.text;
	return (
		<box
			flexDirection="row"
			flexGrow={1}
			flexBasis={0}
			minWidth={0}
		>
			<text fg={colors.subtle} wrapMode="none" flexShrink={0}>
				{props.side ? `${String(props.side.line).padStart(props.gutter)} ${props.sign} ` : " ".repeat(props.gutter + 3)}
			</text>
			<text fg={color()} selectable wrapMode="char" flexGrow={1} flexShrink={1} minWidth={0}>
				{props.side?.text || " "}
			</text>
		</box>
	);
}

export function SplitDiffView(props: { rows: readonly SplitDiffRow[] }) {
	const gutter = () => {
		let max = 1;
		for (const row of props.rows)
			if (row.kind !== "hunk")
				max = Math.max(max, row.left?.line ?? 0, row.right?.line ?? 0);
		return String(max).length;
	};
	return (
		<For each={props.rows}>
			{(row) => (
				<Show
					when={row.kind !== "hunk" ? row : undefined}
					fallback={
						<text fg={diffLineColor("@@")} wrapMode="none" flexShrink={0}>
							{row.kind === "hunk" ? row.text : ""}
						</text>
					}
				>
					{(sides) => (
						<box flexDirection="row" flexShrink={0}>
							<SplitDiffHalf
								side={sides().left}
								sign={sides().kind === "change" ? "-" : " "}
								gutter={gutter()}
							/>
							<text fg={colors.border} wrapMode="none" flexShrink={0}>
								{"│"}
							</text>
							<SplitDiffHalf
								side={sides().right}
								sign={sides().kind === "change" ? "+" : " "}
								gutter={gutter()}
							/>
						</box>
					)}
				</Show>
			)}
		</For>
	);
}
