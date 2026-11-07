/** The sample files of the repository, as the tests of the map hand them to the picker, with the projection file each needs. */
import { readFileSync } from 'node:fs';
import { fixturePath } from './picker.js';
import type { Sample } from './picker.js';

/** A sample file of the repository, under the name it is to be chosen as. */
export function fixture(name: string, as = name): Sample {
  return { name: as, mimeType: 'text/plain', buffer: readFileSync(fixturePath(name)) };
}

/** A projection file (UTM zone 40 north, as the fixtures are in) for a data file that has none of its own, named after it so that it is paired. */
export const projectionFor = (file: string): Sample => fixture('points.prj', file);
