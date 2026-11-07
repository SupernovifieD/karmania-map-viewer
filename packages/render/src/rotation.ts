/**
 * Sine and cosine of an angle in degrees, exact for the multiples of 90, so that something turned a quarter, a half or three quarters
 * of a turn (a grid, a block model) is exactly where it should be: the engine's own turning is exact for them too (`rotation_sin_cos`), and
 * the two must agree for the image of a grid to meet the positions that the engine worked out.
 */
export function sinCos(degrees: number): [sin: number, cos: number] {
  const turn = ((degrees % 360) + 360) % 360;
  switch (turn) {
    case 0:
      return [0, 1];
    case 90:
      return [1, 0];
    case 180:
      return [0, -1];
    case 270:
      return [-1, 0];
    default: {
      const radians = (turn * Math.PI) / 180;
      return [Math.sin(radians), Math.cos(radians)];
    }
  }
}
