# Design tokens

Every margin, padding, gap, size, radius, color, duration and layer in the UI is a
token, defined once in `packages/ui/src/tokens.css`. Component CSS uses
`var(--k-...)` and has no magic numbers. A unit test (`tokens.test.ts`) reads the CSS
and fails if a scale changes, if light and dark fall out of step, if a color stops being
readable, or if this page lists a token that does not exist or leaves one out.

Import the tokens once, at the top of the page:

```ts
import '@karmania/ui/tokens.css';
```

Custom properties inherit into shadow roots, so the components see them without
importing anything.

## Spacing

Every margin, padding and gap is one of these steps. The 4 px grid is the rule; 2 is
for hairline adjustments such as the gap between a badge and its edge.

| Token           | Value |
| --------------- | ----- |
| `--k-space-2`   | 2px   |
| `--k-space-4`   | 4px   |
| `--k-space-8`   | 8px   |
| `--k-space-12`  | 12px  |
| `--k-space-16`  | 16px  |
| `--k-space-24`  | 24px  |
| `--k-space-32`  | 32px  |
| `--k-space-48`  | 48px  |

## Type

The font is Inter, self-hosted (step 6.3), falling back to the system font:
`--k-font-sans`. Numbers use tabular numerals. Sizes and line heights come in pairs,
and there are only two weights.

| Size token                    | Line height token                | Pair    | Use                    |
| ----------------------------- | -------------------------------- | ------- | ---------------------- |
| `--k-font-size-caption`       | `--k-line-height-caption`        | 12 / 16 | Captions, badges       |
| `--k-font-size-secondary`     | `--k-line-height-secondary`      | 13 / 20 | Tables, secondary text |
| `--k-font-size-body`          | `--k-line-height-body`           | 14 / 20 | Body text              |
| `--k-font-size-section-title` | `--k-line-height-section-title`  | 16 / 24 | Section titles         |
| `--k-font-size-dialog-title`  | `--k-line-height-dialog-title`   | 20 / 28 | Dialog titles          |

| Token                | Value |
| -------------------- | ----- |
| `--k-weight-regular` | 400   |
| `--k-weight-medium`  | 500   |

## Shape and size

| Token                        | Value | Use                                     |
| ---------------------------- | ----- | --------------------------------------- |
| `--k-radius-sm`              | 4px   | Small controls                          |
| `--k-radius-md`              | 6px   | Buttons and inputs                      |
| `--k-radius-lg`              | 8px   | Cards and dialogs                       |
| `--k-control-height-compact` | 28px  | Controls inside tables                  |
| `--k-control-height`         | 32px  | Default controls                        |
| `--k-hit-target`             | 32px  | Least focusable area of an icon button  |
| `--k-tab-height`             | 40px  | A tab, and so the header of a tabbed panel |
| `--k-icon-size-sm`           | 16px  | Icons beside text, kind icons in lists  |
| `--k-icon-size-md`           | 20px  | Icons alone in a button                 |
| `--k-icon-size-lg`           | 32px  | The icon of an empty state              |
| `--k-border-width`           | 1px   | A control's border (may be transparent) |
| `--k-focus-width`            | 2px   | Focus ring, drawn in `--k-accent`       |
| `--k-focus-offset`           | 2px   | Gap between the control and its ring    |

The focus ring is drawn on `:focus-visible` and must never be clipped by an
`overflow` ancestor.

### The app shell

| Token                      | Value | Use                                          |
| -------------------------- | ----- | -------------------------------------------- |
| `--k-toolbar-height`       | 48px  | The toolbar across the top                   |
| `--k-panel-width-default`  | 360px | How wide the side panel is until it is resized |
| `--k-panel-rail-width`     | 40px  | The side panel folded away into its rail of buttons |
| `--k-resize-hit-width`     | 6px   | The strip along the panel's edge that can be grabbed to resize it |
| `--k-mapping-column-width` | 160px | A column of the import wizard's preview table |

### The dialog

| Token                       | Value | Use                                          |
| --------------------------- | ----- | -------------------------------------------- |
| `--k-dialog-max-size`       | 720px | The most a dialog is wide and tall; the window less 48 if that is less |
| `--k-dialog-header-height`  | 56px  | The band with the title and the close button |
| `--k-dialog-footer-height`  | 64px  | The band with the buttons                    |

## Motion

| Token                  | Value    | Use                                     |
| ---------------------- | -------- | --------------------------------------- |
| `--k-motion-duration`  | 150ms    | State changes. 0ms under `prefers-reduced-motion: reduce` |
| `--k-motion-easing`    | ease-out | All transitions                         |

Never animate a property that affects layout.

## Layers

Lowest first.

| Token             | Value | Use                          |
| ----------------- | ----- | ---------------------------- |
| `--k-z-base`      | 0     | Ordinary content             |
| `--k-z-sticky`    | 10    | Sticky headers and columns   |
| `--k-z-overlay`   | 100   | Overlays, menus              |
| `--k-z-dialog`    | 200   | Dialogs                      |
| `--k-z-tooltip`   | 300   | Tooltips, above everything   |

## Colors

Semantic names only; no component uses a raw color. Each token has a light and a dark
value. Dark follows `prefers-color-scheme`, and a `data-theme="light"` or
`data-theme="dark"` attribute on the root element forces either one.

| Token                 | Light     | Dark      | Use                                              |
| --------------------- | --------- | --------- | ------------------------------------------------ |
| `--k-surface`         | `#ffffff` | `#14171c` | Toolbar, panel, dialogs                          |
| `--k-surface-raised`  | `#f4f5f7` | `#1c2027` | Table headers, hover, cards on a surface         |
| `--k-surface-map`     | `#e9ecf0` | `#0e1013` | The map area                                     |
| `--k-text`            | `#1a1d21` | `#e6e9ee` | Text                                             |
| `--k-text-muted`      | `#555e6b` | `#9ba5b3` | Secondary text, `null`, row numbers              |
| `--k-border`          | `#dfe3e8` | `#2d333c` | Dividers (decorative)                            |
| `--k-border-strong`   | `#7d8794` | `#6f7a89` | The boundary of a control                        |
| `--k-accent`          | `#1a56c4` | `#7aa7ff` | Primary actions, links, the focus ring           |
| `--k-on-accent`       | `#ffffff` | `#0a1020` | Text and icons on `--k-accent`                   |
| `--k-danger`          | `#b42318` | `#ff8b82` | Errors                                           |
| `--k-warning`         | `#8a5300` | `#f0b94a` | Warnings                                         |
| `--k-info`            | `#0b6580` | `#63c9e8` | Information                                      |
| `--k-scrim`           | `#0a0c10` | `#000000` | The page behind a dialog, at about 40% opacity   |

### Contrast

Measured as WCAG 2 contrast ratios and enforced by the test. The figure is the
lowest over the three surfaces (`--k-surface`, `--k-surface-raised`, `--k-surface-map`).

| Color                  | Needs | Light | Dark  |
| ---------------------- | ----- | ----- | ----- |
| `--k-text`             | 4.5   | 14.27 | 13.42 |
| `--k-text-muted`       | 4.5   | 5.54  | 6.56  |
| `--k-accent`           | 4.5   | 5.59  | 6.85  |
| `--k-danger`           | 4.5   | 5.55  | 7.21  |
| `--k-warning`          | 4.5   | 5.34  | 9.14  |
| `--k-info`             | 4.5   | 5.56  | 8.60  |
| `--k-border-strong`    | 3     | 3.07  | 3.75  |
| `--k-on-accent` on `--k-accent` | 4.5 | 6.62 | 7.94 |

`--k-border` is a decorative divider: it separates areas but is not what tells a person
that a control is there, so it is deliberately gentler than the 3:1 a control boundary
needs.
