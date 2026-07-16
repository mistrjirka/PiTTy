# PiTTy branding

[← Back to README](../README.md) · [Documentation index](README.md)

PiTTy's mark is **`[> π <]`**: two terminal brackets contain inward prompt chevrons and a centered asymmetric pi symbol. The left `π` leg is straight, the right leg curls outward, and equal clear space separates the chevrons from the center mark. The tiny form reads naturally in a command line while the same geometry scales into a full repository logo.

## Canonical assets

| Asset | Purpose |
|---|---|
| [`pitty-logo.svg`](images/pitty-logo.svg) | Canonical dark mark for light backgrounds |
| [`pitty-logo-dark.svg`](images/pitty-logo-dark.svg) | Blue mark for dark backgrounds |
| [`pitty-terminal-preview.svg`](images/pitty-terminal-preview.svg) | Vector preview of the compact terminal raster |
| [`src/ui/logo.tsx`](../src/ui/logo.tsx) | Responsive OpenTUI implementation |

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/pitty-logo-dark.svg">
    <img src="images/pitty-logo.svg" width="420" alt="PiTTy asymmetric bracket-pi logo: [> π <]">
  </picture>
</p>

The canonical SVG uses paths only. It embeds no font, raster image, or JavaScript.

## Terminal rendering

The micro mark is plain Unicode:

```text
[> π <]
```

For the empty dashboard, PiTTy rasterizes the canonical vector geometry into a binary pixel grid and packs two vertical pixels into each terminal cell using the standard block elements:

- `▀` — upper half
- `▄` — lower half
- `█` — both halves

The vector-derived raster preserves the wider chevron spacing and the asymmetric `π`: a straight left leg and curled right leg. It avoids dependence on Braille shapes, combining characters, or a bundled font. PiTTy currently ships:

| Variant | Cell size | Intended use |
|---|---:|---|
| Compact raster | 32 × 8 | Normal empty dashboard |
| Wide raster | 41 × 12 | Large terminal |
| Micro mark | 7 × 1 | Narrow or short terminal |
| Wordmark | 5 × 1 | Extremely constrained dashboard |

<p align="center">
  <img src="images/pitty-terminal-preview.svg" width="760" alt="PiTTy compact half-block terminal logo preview">
</p>

## Usage guidance

- Keep the exact ordering and spacing of `[> π <]`.
- Preserve the asymmetric `π`: straight left leg, curled right leg.
- Keep the capitalization exactly `PiTTy`.
- Use the canonical dark asset on light surfaces and the blue dark-mode asset on dark surfaces.
- Preserve clear space around the icon of at least the width of one chevron.
- Do not substitute a generic terminal window containing `>_`; the centered `π` is the identifying element.
- Use the shared `Logo` component in OpenTUI rather than copying the embedded raster strings.
- Do not ship or embed a font file. The repository stores only the resulting block-cell raster.

## Raster and social exports

Raster exports should be produced from the canonical SVG at the target size. A GitHub social-preview image should place the mark on a deliberate wide canvas rather than stretching the icon.

The repository avatar is inherited from the owning GitHub account and is not a PiTTy branding surface. Configure a repository social preview separately in GitHub settings.
