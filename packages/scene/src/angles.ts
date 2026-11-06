/** The two ways the scene keeps an angle right: a heading as one turn, an elevation between the poles it may not pass. */

/** The degrees from 0 up to, not including, 360 that point the same way as `degrees`; anything not a number is left for the check to refuse. */
export function normalHeading(degrees: number): number {
  return Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : degrees;
}

/** The elevation held between -89 and 89 degrees (section 9.5 of the brief); anything not a number is left for the check to refuse. */
export function heldElevation(degrees: number): number {
  return Number.isFinite(degrees) ? Math.min(89, Math.max(-89, degrees)) : degrees;
}
