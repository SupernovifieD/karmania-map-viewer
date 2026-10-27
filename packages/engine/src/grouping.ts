/**
 * Groups the files a user picked: a data file goes together with the sidecar files that
 * describe it, so that they are looked at as one. The only sidecar in phase 1 is a `.prj`
 * file, which holds the coordinate system.
 */
import type { PreviewGroup } from './protocol.js';

/** The extensions of files that only describe another file. */
const SIDECAR_EXTENSIONS: readonly string[] = ['prj'];

/**
 * Where a file is: its path when it came from a folder, otherwise just its name. Files
 * from different folders are not about each other even if their names match.
 */
function pathOf(file: File): string {
  const path: unknown = file.webkitRelativePath;
  return typeof path === 'string' && path !== '' ? path : file.name;
}

function split(path: string): { readonly stem: string; readonly extension: string } {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash + 1
    ? { stem: path.slice(0, dot).toLowerCase(), extension: path.slice(dot + 1).toLowerCase() }
    : { stem: path.toLowerCase(), extension: '' };
}

/**
 * One group for each file that is not a sidecar of another file, in the order given. A
 * sidecar belongs to every other file with the same path up to the extension, ignoring
 * case. A sidecar with no such file is a file like any other and is on its own.
 */
export function groupFiles(files: readonly File[]): PreviewGroup[] {
  const described = files.map((file) => ({ file, ...split(pathOf(file)) }));
  const isSidecar = (entry: { readonly extension: string }): boolean =>
    SIDECAR_EXTENSIONS.includes(entry.extension);
  const stemsOfDataFiles = new Set(described.filter((e) => !isSidecar(e)).map((e) => e.stem));
  const groups: PreviewGroup[] = [];
  for (const entry of described) {
    if (isSidecar(entry) && stemsOfDataFiles.has(entry.stem)) {
      continue;
    }
    groups.push({
      file: entry.file,
      sidecars: isSidecar(entry)
        ? []
        : described.filter((e) => isSidecar(e) && e.stem === entry.stem).map((e) => e.file),
    });
  }
  return groups;
}
