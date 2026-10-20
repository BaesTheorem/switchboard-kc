# Design

The web app keeps the iPhone app's design: stock Material Design 3 with a
tonal scheme around one blue. The iPhone values are in
`ios/KC311/Sources/Theme.swift`; `public/css/app.css` copies them as CSS
variables. Change both together.

## Type

The system font: SF Pro on Apple devices, Roboto on Android, Segoe UI on
Windows (`--font` in `app.css`). No web font is downloaded for text. Icons are
Material Symbols Outlined, cut down to the icons the app uses
(`bin/vendor.mjs`).

| Role | Size | Weight |
| --- | --- | --- |
| Screen title (app bar) | 17 px | 600 |
| Title (`.title2`) | 22 px | 600 |
| Headline (`.headline`) | 17 px | 600 |
| Body (`.sub`) | 15 px | 400 |
| Caption (`.caption`) | 12 px | 400 |
| Section label (`.label`) | 15 px | 600, on-surface-variant |

## Palette

Five named tokens. The other MD3 roles in `app.css` derive from them.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--primary` | `#005ccc` | `#adc7ff` | Buttons, links, icons, the "in progress" status |
| `--surface` | `#fafaff` | `#121217` | Page background |
| `--surface-container` | `#edf0f7` | `#1c2024` | Cards, tiles, grouped rows |
| `--on-surface` | `#1a1c21` | `#e3e3e8` | Text |
| `--error-container` | `#ffd9d6` | `#94000a` | Health and help, errors |

Status colors: open `#d98000` / `#ffba5c`, done `#218c4d` / `#6ed68c`,
in progress = `--primary`.

## Spacing

An 8 px scale: 8, 16, 24, with 4 and 12 as half steps (`.stack.s4` to
`.stack.s24`). Pages have 16 px padding and a 720 px maximum width.

## Shape

One radius, 12 px, for cards and inputs. MD3's stock shapes are the only
other ones: 16 px tiles, 28 px sheets, and full pills for buttons and chips.

## Rules

- No gradients or shadows, except one soft shadow (`0 2px 6px rgba(0,0,0,.18)`)
  on controls that float over the map.
- Every control is at least 44 px tall.
- Components come from Beer CSS (`public/vendor/beercss`) or the small set in
  `app.css`. Maps are MapLibre GL JS with OpenFreeMap's Positron (light) and
  Dark styles.
