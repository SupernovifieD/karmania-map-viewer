/** How the commands name the layers and groups they make: `layer-1`, `layer-2`, `group-1`... */

/**
 * The next id with `prefix`: one more than the highest number among `existing` that is `prefix` and a number. The
 * ids the document has are all it can go by (it keeps no counter), so a number that was given up by removing the
 * layer with the highest one is given out again; nothing else refers to a layer that is gone.
 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0;
  for (const id of existing) {
    const found = pattern.exec(id);
    if (found?.[1] !== undefined) {
      highest = Math.max(highest, Number(found[1]));
    }
  }
  return `${prefix}-${String(highest + 1)}`;
}

/** The number in an id made by {@link nextId}, or 0 for any other id. */
export function numberOf(id: string): number {
  const found = /-(\d+)$/.exec(id);
  return found?.[1] === undefined ? 0 : Number(found[1]);
}
