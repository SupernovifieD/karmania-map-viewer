/** How the commands name the layers and groups they make: `layer-1`, `layer-2`, `group-1`... */

/**
 * The next id with `prefix`: one more than the highest number among `existing` that is `prefix` and a number. `existing`
 * is every id there is, layers and groups alike, wherever they are, since a group never has the id of a layer. The
 * ids the document has are all it can go by (it keeps no counter), so a number that was given up by removing the layer
 * with the highest one is given out again; nothing else refers to a layer that is gone. The numbers are read as
 * whole numbers of any size, not as doubles, which lose their last digits above 9,007,199,254,740,991 and would give
 * an id that is already there.
 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highest = 0n;
  for (const id of existing) {
    const found = pattern.exec(id);
    if (found?.[1] !== undefined) {
      const number = BigInt(found[1]);
      if (number > highest) {
        highest = number;
      }
    }
  }
  return `${prefix}-${String(highest + 1n)}`;
}

/**
 * The place in a palette of `size` colours that the layer with this id takes: its number less one, and round again after the
 * last. 0 for an id with no number, or the number 0. Whole numbers of any size, as for {@link nextId}.
 */
export function ordinalOf(id: string, size: number): number {
  const found = /-(\d+)$/.exec(id);
  const number = found?.[1] === undefined ? 0n : BigInt(found[1]);
  if (number === 0n) {
    return 0;
  }
  return Number((number - 1n) % BigInt(size));
}
