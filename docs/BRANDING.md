# PiTTy branding

[← Back to README](../README.md) · [Documentation index](README.md)

PiTTy's mark is **`[> π <]`**: two terminal brackets contain inward prompt chevrons and a centered pi symbol. The tiny mark reads naturally in a command line, while the same geometry scales into a full repository logo.

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
    <img src="images/pitty-logo.svg" width="420" alt="PiTTy bracket-pi logo: [> π <]">
  </picture>
</p>

The canonical SVG uses paths only. It embeds no font, raster image, or JavaScript.

## Terminal rendering

The micro mark is plain Unicode:

```text
[> π <]
```

For the empty dashboard, PiTTy uses larger pre-rasterized versions. The complete string `[> π <]` was typeset as one unit in DejaVu Sans Mono Bold so both spaces around `π` remain equal. Its bitmap is stored directly in the source using the standard block elements:

- `▀` — upper half
- `▄` — lower half
- `█` — both halves

This avoids dependence on Braille shapes, combining characters, or a bundled font. PiTTy currently ships:

| Variant | Cell size | Intended use |
|---|---:|---|
| Compact raster | 85 × 10 | Normal empty dashboard |
| Wide raster | 118 × 14 | Large terminal |
| Micro mark | 7 × 1 | Narrow or short terminal |
| Wordmark | 5 × 1 | Extremely constrained dashboard |

<p align="center">
  <img src="images/pitty-terminal-preview.svg" width="760" alt="PiTTy compact half-block terminal logo preview">
</p>

An emergency two-row geometric mark remains available only for terminals eight rows tall or shorter, where the normal dashboard cannot fit.

## Usage guidance

- Keep the exact ordering and spacing of `[> π <]`.
- Keep the capitalization exactly `PiTTy`.
- Use the canonical dark asset on light surfaces and the blue dark-mode asset on dark surfaces.
- Preserve clear space around the icon of at least the width of one chevron.
- Do not substitute a generic terminal window containing `>_`; the centered `π` is the identifying element.
- Use the shared `Logo` component in OpenTUI rather than copying the embedded raster strings.
- Do not ship or embed a font file. The repository stores only the resulting block-cell raster.

## Raster and social exports

Raster exports should be produced from the canonical SVG at the target size. A GitHub social-preview image should place the mark on a deliberate wide canvas rather than stretching the icon.

The repository avatar is inherited from the owning GitHub account and is not a PiTTy branding surface. Configure a repository social preview separately in GitHub settings.
