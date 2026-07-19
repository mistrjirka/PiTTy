# PiTTy themes

PiTTy ships ten complete semantic palettes. Each preset maps published upstream swatches onto PiTTy's 25 semantic tokens. Tokens that upstream themes do not define—especially thinking, tool, and diff surfaces—are PiTTy adaptations made only from that theme's own neutral or documented diff swatches.

| PiTTy preset | Upstream palette source | PiTTy adaptation | License |
| --- | --- | --- | --- |
| PiTTy Midnight | PiTTy's original palette in [`src/ui/theme.ts`](../src/ui/theme.ts) and Tailwind's [Zinc palette](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/compat/colors.ts) | Keeps PiTTy's original surfaces and accents. `muted` uses Zinc 400 because the original `#71717A` is only 4.117:1 on the background; `subtle` retains `#71717A` for decorative text. | [PiTTy MIT](../LICENSE), [Tailwind MIT](https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE) |
| Catppuccin Mocha | Official [`palette.json`](https://github.com/catppuccin/palette/blob/main/palette.json) | Base/mantle/surface swatches provide panels, selection, thinking, tools, and diff; named accents retain their upstream roles. | [MIT](https://github.com/catppuccin/palette/blob/main/LICENSE) |
| Catppuccin Latte | Official [`palette.json`](https://github.com/catppuccin/palette/blob/main/palette.json) | Light base/mantle/surface swatches provide panels and tool surfaces. Subtext 1 (`#5C5F77`) is used for secondary text because Subtext 0 does not reach 4.5:1 on Base. | [MIT](https://github.com/catppuccin/palette/blob/main/LICENSE) |
| Tokyo Night Storm | Tokyo Night v4.14.1 [`colors/storm.lua`](https://github.com/folke/tokyonight.nvim/blob/v4.14.1/lua/tokyonight/colors/storm.lua) | Storm background variants provide panels, selection, thinking, tools, and diff surfaces. | [Apache-2.0](https://github.com/folke/tokyonight.nvim/blob/v4.14.1/LICENSE) |
| Gruvbox Dark | Official [`colors/gruvbox.vim`](https://github.com/morhetz/gruvbox/blob/master/colors/gruvbox.vim) | Dark0–Dark3 provide surfaces; Light and bright named colors provide text and statuses. | [MIT/X11](https://github.com/morhetz/gruvbox/blob/master/LICENSE) |
| Nord | Official [`src/nord.scss`](https://github.com/nordtheme/nord/blob/develop/src/nord.scss) | Polar Night provides every surface; Snow Storm provides readable text; Frost and Aurora provide accents/statuses. | [MIT](https://github.com/nordtheme/nord/blob/develop/license) |
| Dracula | Official [OSS color palette](https://github.com/dracula/dracula-theme/blob/main/README.md#color-palette-oss) | Background and Current Line provide surfaces and selection. Foreground is reused for secondary text because Comment is decorative and below 4.5:1. | [MIT](https://github.com/dracula/dracula-theme/blob/main/LICENSE) |
| Rosé Pine Moon | Official [`source/index.ts`](https://github.com/rose-pine/rose-pine-palette/blob/main/source/index.ts) and [role definitions](https://github.com/rose-pine/rose-pine-palette/blob/main/README.md#roles) | Base/surface/overlay/highlight roles provide all surfaces; named role colors provide statuses and syntax. Text is reused for secondary copy because Muted falls below 4.5:1 on raised/tool surfaces. | [MIT](https://github.com/rose-pine/rose-pine-palette/blob/main/license) |
| Kanagawa Wave | Official [`colors.lua`](https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/colors.lua) and semantic [`themes.lua`](https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/themes.lua) | Sumi Ink and Wave Blue swatches provide surfaces/selection; Old White is readable secondary text; named Winter diff colors inform the semantic mapping. | [MIT](https://github.com/rebelot/kanagawa.nvim/blob/master/LICENSE) |
| Solarized Light | Official [`solarized.vim`](https://github.com/altercation/solarized/blob/master/vim-colors-solarized/colors/solarized.vim) canonical table | Base3/Base2 provide light surfaces and Base1 selection. Base02 (`#073642`) is used for primary and secondary text so both Base3 and raised Base2 surfaces exceed 4.5:1. | [MIT](https://github.com/altercation/solarized/blob/master/LICENSE) |

Preset definitions are complete: no preset falls back to another preset's values. Reusing one upstream neutral for several PiTTy-only surfaces is intentional semantic adaptation, not inheritance.

## Configuration

Theme settings are user-global PiTTy configuration and are never written to Pi's settings:

- Windows: `%APPDATA%\PiTTy\settings.json`
- Linux: `$XDG_CONFIG_HOME/pitty/settings.json`, otherwise `~/.config/pitty/settings.json`
- macOS: `$XDG_CONFIG_HOME/pitty/settings.json`, otherwise `~/Library/Application Support/PiTTy/settings.json`

PiTTy validates the complete versioned document before applying it. Malformed input leaves the source file untouched and starts with PiTTy Midnight plus an actionable warning. Valid changes use a same-directory temporary file and atomic replacement.

Contrast follows [WCAG 2.2 Success Criterion 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum) and its [relative-luminance definition](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance). Shipped primary and secondary text pairs must meet 4.5:1 without rounding. Custom low-contrast colors remain allowed but produce a warning and retain one-action reset.
