/**
 * The units of the map's coordinate system, which the scale bar is measured in (section 10.2 of the brief). A local grid says
 * what its units are in the frame itself. An EPSG code does not: they are in the definitions, which the engine has and has to be
 * asked, and until it has answered they are pending. A code that is not in the definitions has no units that are known either.
 */
import type { CrsInfo } from '@karmania/engine';
import type { Frame } from '@karmania/engine/display';
import type { CrsUnits } from '@karmania/engine/types';

/**
 * The units of the map the frame is for: `undefined` when there is no map; `'pending'` when the map is in an EPSG system that the
 * definitions have not answered about yet (`info` is `undefined`); `other` for a code that is not in the definitions (`info` is
 * `null`), whose units nobody knows. `info` is what the definitions say of the frame's code, and is not looked at for a local grid.
 */
export function unitsOf(
  frame: Frame | null,
  info: CrsInfo | null | undefined,
): CrsUnits | 'pending' | undefined {
  if (frame === null) {
    return undefined;
  }
  const { mapCrs } = frame;
  if (mapCrs.kind === 'local') {
    return mapCrs.units;
  }
  if (info === undefined) {
    return 'pending';
  }
  return info === null ? 'other' : info.units;
}
