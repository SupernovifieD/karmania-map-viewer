/** Reads a computed CSS color (`rgb(...)`, `rgba(...)` or `color(srgb ...)`) as red, green, blue, 0 to 255. */
export function parseColor(css: string): [number, number, number] {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
  if (srgb) {
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  }
  const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  throw new Error(`Not a color the tests can read: ${css}`);
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (lr ?? 0) + 0.7152 * (lg ?? 0) + 0.0722 * (lb ?? 0);
}

/** The WCAG contrast ratio between two computed colors. */
export function contrastBetween(a: string, b: string): number {
  const [lighter, darker] = [luminance(parseColor(a)), luminance(parseColor(b))].sort(
    (x, y) => y - x,
  );
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}
