/**
 * What the exported picture is drawn with (section 10.6 of the brief): the **light** theme, whatever the theme of the page is, and the sizes of the type and of
 * the rows of the legend. A canvas has no custom properties, so the colours of `packages/ui/src/tokens.css` are written here, and a test reads the stylesheet so that
 * they cannot drift from it. Every length is in pixels of a screen of 96 to the inch: the picture multiplies them by `dpi / 96` (`export-layout.ts`).
 */

/** The colours of the light theme (the `--k-*` of the stylesheet with the same name), as `#rrggbb`. */
export const EXPORT_COLOURS = {
  /** The page behind everything: `--k-surface`. */
  surface: '#ffffff',
  /** The map where nothing is drawn: `--k-surface-map`. */
  map: '#e9ecf0',
  /** What the furniture over the map is on: `--k-surface-raised`. */
  raised: '#f4f5f7',
  /** Text: `--k-text`. */
  text: '#1a1d21',
  /** The less important text, the counts of a legend: `--k-text-muted`. */
  muted: '#555e6b',
  /** The line round the map: `--k-border-strong`. */
  border: '#7d8794',
  /** The decorative line, `--k-border`. */
  divider: '#dfe3e8',
  /** The head of the north arrow's needle: `--k-accent`. */
  accent: '#1a56c4',
} as const;

/** The type of the picture (the type scale of the stylesheet: `--k-font-size-*` and `--k-line-height-*`), in pixels, and the weights used. */
export const EXPORT_TYPE = {
  /** The family; the file is Inter (`packages/ui/src/fonts`), which the export waits for before it measures or draws. */
  family: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  /** Names of layers and groups: body. */
  name: { size: 14, line: 20 },
  /** The lines of classes: secondary text. */
  class: { size: 13, line: 20 },
  /** The label of the scale bar: caption. */
  caption: { size: 12, line: 16 },
  /** The weight of text, and of a group's name. */
  regular: 400,
  medium: 500,
} as const;

/**
 * The rows of the exported legend, as the Legend tab has them (`legend-tab.ts`): a row of a layer or a group is 32 high, a row of a class 24; a layer's swatch is
 * 16 by 16, or its ramp 24 by 12; a class's swatch is 12; what is in a group is 24 further in; what is beside a swatch is 8 from it (the gap between an icon and its label).
 */
export const LEGEND_ROW = {
  layer: 32,
  group: 32,
  class: 24,
  swatch: 16,
  rampWidth: 24,
  rampHeight: 12,
  classSwatch: 12,
  indent: 24,
  gap: 8,
  /** The least the text of a count is from the label before it. */
  countGap: 16,
} as const;

/** The box of the furniture over the map (the north arrow and the scale bar), as the screen has it: a raised surface, a line of 1 round it, corners of 8 (`--k-radius-lg`). */
export const EXPORT_FURNITURE = { border: 1, radius: 8 } as const;

/** The scale bar of the picture, as the one on the screen (`scale-bar.ts` of the viewer): 24 high, ticks of its height at the ends, a line of 2. */
export const EXPORT_SCALE_BAR = {
  height: 24,
  /** The widest the bar is, as on the screen. */
  maxWidth: 160,
  line: 2,
  /** The space between the end of the bar and its label. */
  gap: 8,
} as const;
