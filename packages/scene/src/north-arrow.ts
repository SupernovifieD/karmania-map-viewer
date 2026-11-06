/**
 * The north arrow as data, for the screen (step 17.1) and the export (step 22.2) to draw the same needle. It
 * points to grid north of the map's coordinate system (up is +y), which is not true north (section 9.5 of the brief).
 */

/** What the north arrow shows. */
export interface NorthArrow {
  /**
   * How far the needle is turned, in degrees clockwise from straight up: minus the heading, brought into -180 up to
   * 180. A map turned to face east (heading 90) has north on the left, which is -90.
   */
  readonly angle: number;
  /** The heading as a whole number of degrees from 0 up to 360 (360 is 0). */
  readonly degrees: number;
  /** Whether north is up, to the whole degree. */
  readonly northUp: boolean;
  /** For a screen reader: `North is up`, or `Map turned 30° from north`. */
  readonly label: string;
}

/** The degrees from 0 up to, not including, 360 that point the same way. */
function turn(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The north arrow for a map whose top faces `heading` degrees clockwise from grid north (the camera's heading). A
 * heading that is not a number gives an arrow that points up: nothing is known to turn it.
 */
export function northArrow(heading: number): NorthArrow {
  const known = Number.isFinite(heading);
  const turned = known ? turn(heading) : 0;
  const whole = turned >= 359.5 ? 0 : Math.round(turned);
  const angle = turned === 0 ? 0 : turned < 180 ? -turned : 360 - turned;
  const northUp = whole === 0;
  return {
    angle,
    degrees: whole,
    northUp,
    label: northUp ? 'North is up' : `Map turned ${String(whole)}° from north`,
  };
}
