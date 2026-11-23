/** Render bounded tool-result images with OpenTUI's terminal protocol detection. */
import { imageInfo } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import type { ToolResultImage } from "../state/conversation-shared.ts";
import { colors } from "./theme.ts";

const MAX_IMAGE_PIXELS = 24_000_000;
const MAX_IMAGE_SIDE = 12_000;

type PreparedImage = {
	bytes: Uint8Array;
	width: number;
	height: number;
	format: string;
};

export function prepareToolImage(image: ToolResultImage): PreparedImage | undefined {
	try {
		// Decode only after the display accepts this image. The bytes are never
		// interpreted as terminal text or used in the collapsed text preview.
		const bytes = Buffer.from(image.data, "base64");
		const info = imageInfo(bytes);
		if (info.width <= 0 || info.height <= 0 ||
			info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE ||
			info.width * info.height > MAX_IMAGE_PIXELS ||
			`image/${info.format}` !== image.mimeType) return undefined;
		return { bytes, width: info.width, height: info.height, format: info.format };
	} catch {
		return undefined;
	}
}

function ImagePreview(props: {
	image: ToolResultImage;
	id: string;
	expanded: boolean;
}) {
	const viewport = useTerminalDimensions();
	const prepared = createMemo(() => prepareToolImage(props.image));
	const [loadFailed, setLoadFailed] = createSignal(false);
	const size = () => {
		const image = prepared();
		const maxHeight = props.expanded ? 18 : 9;
		const maxWidth = Math.max(12, Math.min(props.expanded ? 66 : 38, viewport().width - 48));
		if (!image) return { width: maxWidth, height: maxHeight };
		// A terminal cell is about twice as tall as it is wide. Constrain
		// previews by both dimensions and keep portrait screenshots legible.
		const naturalColumns = Math.max(12, Math.round(maxHeight * image.width / image.height * 2));
		return { width: Math.min(maxWidth, naturalColumns), height: maxHeight };
	};
	return (
		<box id={props.id} flexDirection="column" minWidth={0} flexShrink={0}>
			<text fg={colors.subtle} wrapMode="none">
				{prepared()
					? `Image · ${prepared()!.format.toUpperCase()} · ${prepared()!.width}×${prepared()!.height}`
					: "Image preview unavailable"}
			</text>
			<Show when={loadFailed() ? undefined : prepared()}>
				{(value) => <image id={`${props.id}-pixels`}
					source={value().bytes} protocol="auto" fit="fit"
					width={size().width} height={size().height}
					onError={() => setLoadFailed(true)} />}
			</Show>
			<Show when={loadFailed()}>
				<text fg={colors.muted}>Could not decode this image.</text>
			</Show>
		</box>
	);
}

/** The built-in auto protocol selects Kitty, Sixel or Unicode blocks. */
export function ToolImagePreviews(props: {
	id: string;
	images: readonly ToolResultImage[];
	expanded: boolean;
}) {
	return <box id={props.id} flexDirection="column" minWidth={0} paddingTop={1}>
		<For each={props.expanded ? props.images : props.images.slice(0, 1)}>
			{(image, index) => <ImagePreview
				id={`${props.id}-${index()}`} image={image} expanded={props.expanded} />}
		</For>
		<Show when={!props.expanded && props.images.length > 1}>
			<text fg={colors.subtle}>
				{`+${props.images.length - 1} more images in details`}
			</text>
		</Show>
	</box>;
}
