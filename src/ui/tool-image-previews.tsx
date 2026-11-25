/** Render bounded tool-result images with OpenTUI's terminal protocol detection. */
import { type BoxRenderable, type ImageRenderable, imageInfo } from "@opentui/core";
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
	availableWidth: number;
}) {
	const viewport = useTerminalDimensions();
	const prepared = createMemo(() => prepareToolImage(props.image));
	const [loadFailed, setLoadFailed] = createSignal(false);
	const [imageNode, setImageNode] = createSignal<ImageRenderable>();
	const size = createMemo(() => {
		const image = prepared();
		const node = imageNode();
		const screenRows = Math.max(1, Math.floor(viewport().height * 0.75));
		const maxHeight = props.expanded ? screenRows : Math.min(9, screenRows);
		const maxWidth = props.expanded ? props.availableWidth : Math.min(38, props.availableWidth);
		// Fit both axes using the terminal's cell proportions. The measured
		// container already accounts for sidebars, inspector panels and padding.
		return image && node ? node.getFittedSize(maxWidth, maxHeight, undefined, image.width, image.height)
			: { width: 0, height: 0 };
	});
	return (
		<box id={props.id} flexDirection="column" minWidth={0} flexShrink={0}>
			<text fg={colors.subtle} wrapMode="none">
				{prepared()
					? `Image · ${prepared()!.format.toUpperCase()} · ${prepared()!.width}×${prepared()!.height}`
					: "Image preview unavailable"}
			</text>
			<Show when={loadFailed() ? undefined : prepared()}>
				{(value) => <image id={`${props.id}-pixels`} ref={(node) => setImageNode(node)}
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
	const [availableWidth, setAvailableWidth] = createSignal(0);
	const measure = function (this: BoxRenderable) {
		setAvailableWidth(this.width);
	};
	return <box id={props.id} flexDirection="column" minWidth={0} paddingTop={1}
		onSizeChange={measure}>
		<For each={props.expanded ? props.images : props.images.slice(0, 1)}>
			{(image, index) => <ImagePreview
				id={`${props.id}-${index()}`} image={image} expanded={props.expanded}
				availableWidth={availableWidth()} />}
		</For>
		<Show when={!props.expanded && props.images.length > 1}>
			<text fg={colors.subtle}>
				{`+${props.images.length - 1} more images in details`}
			</text>
		</Show>
	</box>;
}
