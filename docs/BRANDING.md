# PiTTy branding

[← Back to README](../README.md) · [Documentation index](README.md)

PiTTy's mark is the **PTY Tail**: one continuous path joining two square endpoints. It references a pseudoterminal pair while the lower curve subtly suggests a tail and the overall silhouette hints at a `P`.

## Canonical assets

| Asset | Purpose |
|---|---|
| [`pitty-tail-icon.svg`](images/pitty-tail-icon.svg) | Canonical monochrome vector mark for light backgrounds |
| [`pitty-tail-icon-dark.svg`](images/pitty-tail-icon-dark.svg) | Light rendering for dark backgrounds |
| [`pitty-terminal-preview.svg`](images/pitty-terminal-preview.svg) | Documentation preview of the terminal-cell adaptation |
| [`src/ui/logo.tsx`](../src/ui/logo.tsx) | OpenTUI component used inside PiTTy |

The canonical artwork is the light-background SVG. The dark asset and terminal mark are derived renderings, not separate logo concepts.

## Vector mark

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/pitty-tail-icon-dark.svg">
    <img src="images/pitty-tail-icon.svg" width="220" alt="PiTTy PTY Tail vector mark">
  </picture>
</p>

The SVG uses a transparent background, one rounded path, and two rounded-square endpoints. It contains no embedded raster image, external font, or JavaScript.

## Terminal mark

OpenTUI renders terminal cells rather than SVG paths. PiTTy therefore uses a cell-safe interpretation built from Unicode box-drawing characters and two solid endpoint squares:

```text
■────╮
     ╰────────╮
              │
       ╭──────╯
      ╭╯
      ╰──╮
■────────╯
     PiTTy
```

A compact variant is used when the dashboard has less room:

```text
■───╮
    ╰────╮
         │
    ╭────╯
    ╰─╮
■─────╯
  PiTTy
```

Very constrained terminals show only the `PiTTy` wordmark. This is preferable to clipping or changing terminal cell alignment.

<p align="center">
  <img src="images/pitty-terminal-preview.svg" width="760" alt="PiTTy terminal logo preview">
</p>

## Usage guidance

- Preserve the aspect ratio and transparent background of the canonical SVG.
- Use the dark asset on dark surfaces and the canonical asset on light surfaces.
- Leave clear space around the mark of at least one endpoint width.
- Do not place the mark inside a generic terminal-window icon; the PTY Tail should remain the identifying shape.
- Do not replace the endpoint squares with circles or add a literal cat face.
- Keep the wordmark capitalization exactly `PiTTy`.
- In terminal UI, use the shared `Logo` component rather than copying glyph strings into other components.

## Exporting raster artwork

For release pages, package registries, or social previews, export a PNG from the canonical SVG rather than tracing a screenshot. Use a larger canvas with deliberate surrounding space for social-preview cards; do not stretch the square icon to a wide aspect ratio.

The GitHub repository avatar is inherited from the owning account and is not a PiTTy branding surface. A repository social preview can be configured separately from GitHub repository settings.
