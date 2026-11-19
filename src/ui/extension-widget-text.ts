import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core";
import stripAnsi from "strip-ansi";

const attributeCodes = new Map<number, number>([
	[1, TextAttributes.BOLD], [2, TextAttributes.DIM], [3, TextAttributes.ITALIC],
	[4, TextAttributes.UNDERLINE], [5, TextAttributes.BLINK], [7, TextAttributes.INVERSE],
	[8, TextAttributes.HIDDEN], [9, TextAttributes.STRIKETHROUGH],
]);
const resetCodes = new Map<number, number>([
	[22, TextAttributes.BOLD | TextAttributes.DIM], [23, TextAttributes.ITALIC],
	[24, TextAttributes.UNDERLINE], [25, TextAttributes.BLINK], [27, TextAttributes.INVERSE],
	[28, TextAttributes.HIDDEN], [29, TextAttributes.STRIKETHROUGH],
]);

function colorFromParameters(values: number[]): RGBA | undefined {
	if (values[0] === 5 && values.length === 2 && validByte(values[1]))
		return RGBA.fromIndex(values[1]);
	if (values[0] === 2 && (values.length === 4 || values.length === 5)) {
		// Colon SGR may include an empty color-space field before RGB.
		const rgb = values.slice(-3);
		if (rgb.length === 3 && rgb.every(validByte))
			return RGBA.fromInts(rgb[0]!, rgb[1]!, rgb[2]!);
	}
	return undefined;
}

function validByte(value: number | undefined): value is number {
	return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255;
}

/** Preserve text styling without executing terminal cursor, title or clipboard controls. */
export function extensionWidgetText(value: string): StyledText {
	const chunks: TextChunk[] = [];
	let fg: RGBA | undefined;
	let bg: RGBA | undefined;
	let attributes = 0;
	let offset = 0;
	const append = (raw: string): void => {
		const text = stripAnsi(raw).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
		if (text) chunks.push({
			__isChunk: true, text, attributes,
			...(fg ? { fg } : {}), ...(bg ? { bg } : {}),
		});
	};
	for (const match of value.matchAll(/(?:\x1b\[|\x9b)([\d;:]*)m/g)) {
		append(value.slice(offset, match.index));
		offset = match.index! + match[0].length;
		const parameters = match[1]!.split(";");
		for (let index = 0; index < parameters.length; index += 1) {
			const parameter = parameters[index]!;
			const fields = parameter.split(":").map(Number);
			const code = fields[0]!;
			if (code === 0) {
				fg = undefined;
				bg = undefined;
				attributes = 0;
			} else if (code === 38 || code === 48) {
				let values = fields.slice(1);
				if (!parameter.includes(":")) {
					const mode = Number(parameters[index + 1]);
					const count = mode === 2 ? 4 : mode === 5 ? 2 : 1;
					values = parameters.slice(index + 1, index + 1 + count).map(Number);
					index += count;
				}
				const color = colorFromParameters(values);
				if (color) {
					if (code === 38) fg = color;
					else bg = color;
				}
			} else if (code === 39) fg = undefined;
			else if (code === 49) bg = undefined;
			else if (code >= 30 && code <= 37) fg = RGBA.fromIndex(code - 30);
			else if (code >= 90 && code <= 97) fg = RGBA.fromIndex(code - 90 + 8);
			else if (code >= 40 && code <= 47) bg = RGBA.fromIndex(code - 40);
			else if (code >= 100 && code <= 107) bg = RGBA.fromIndex(code - 100 + 8);
			else if (attributeCodes.has(code)) attributes |= attributeCodes.get(code)!;
			else if (resetCodes.has(code)) attributes &= ~resetCodes.get(code)!;
		}
	}
	append(value.slice(offset));
	return new StyledText(chunks);
}
