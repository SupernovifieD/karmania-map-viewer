/**
 * The colours of a legend row as CSS. A swatch is one colour and a ramp preview is the colours of the classes side by side, each as wide as the others;
 * the colours are the scene's, so a colour that is not `#rrggbb` (a document that `validateScene` was not asked about) is drawn as no colour and never put
 * into a style as it is.
 */

const HEX = /^#[0-9a-f]{6}$/i;

/** The colour as `#rrggbb` in lower case, or `transparent` for text that is not one. */
export function safeColour(colour: string): string {
  return HEX.test(colour) ? colour.toLowerCase() : 'transparent';
}

/** A number of per cent with at most four decimals and no trailing zeros: `14.2857`, `50`. */
function percent(value: number): string {
  return `${String(Number(value.toFixed(4)))}%`;
}

/**
 * The `background` of a ramp preview: the colours as stripes of one width, left to right, with hard edges (the classes are steps, not a blend). One
 * colour is a stripe of the whole width; none is `transparent`.
 */
export function rampGradient(colours: readonly string[]): string {
  if (colours.length === 0) {
    return 'transparent';
  }
  const stops = colours.map((colour, k) => {
    const from = percent((k / colours.length) * 100);
    const to = percent(((k + 1) / colours.length) * 100);
    return `${safeColour(colour)} ${from} ${to}`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
