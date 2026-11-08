import type { CrsInfo, Engine } from '@karmania/engine';

/** The most matches a search shows. */
export const MAX_MATCHES = 20;

/**
 * A search of the EPSG definitions by code or by part of a name, as a person types it (the wizard's coordinate system step and the map CRS
 * dialog both have one). The engine is asked for what the box holds when that is not what was last asked; the latest asking wins, so an
 * answer that comes after a newer question is dropped; an empty box finds nothing without asking. `results` is `undefined` until there has been
 * an answer, and `failed` says that the latest search could not be done. `changed` is called when either changes.
 */
export class CrsSearch {
  /** What the latest search found; `undefined` until there has been one. */
  results: readonly CrsInfo[] | undefined = undefined;
  /** Whether the latest search could not be done. */
  failed = false;
  /** What the box held when the engine was last asked, and which asking is the latest. */
  private searched: string | undefined;
  private searching = 0;

  constructor(private readonly changed: () => void) {}

  /** Searches for `query`, if that is not what was last searched for. */
  search(engine: Pick<Engine, 'searchCrs'> | undefined, query: string): void {
    if (engine === undefined || query === this.searched) {
      return;
    }
    this.searched = query;
    const asking = ++this.searching;
    if (query.trim() === '') {
      this.set([], false);
      return;
    }
    engine
      .searchCrs(query, MAX_MATCHES)
      .then((found) => {
        if (asking === this.searching) {
          this.set(found, false);
        }
      })
      .catch(() => {
        if (asking === this.searching) {
          this.set([], true);
        }
      });
  }

  /** Starts again: nothing has been searched for, and nothing was found. */
  reset(): void {
    this.searched = undefined;
    this.searching += 1;
    this.set(undefined, false);
  }

  private set(results: readonly CrsInfo[] | undefined, failed: boolean): void {
    this.results = results;
    this.failed = failed;
    this.changed();
  }

  /** What is said under the search box about what it found: how many, and that there may be more. */
  help(query: string): string {
    const count = this.results?.length ?? 0;
    if (query.trim() === '' || count === 0) {
      return '';
    }
    return count >= MAX_MATCHES
      ? `The first ${String(MAX_MATCHES)} matches; type more to narrow them.`
      : `${String(count)} ${count === 1 ? 'match' : 'matches'}.`;
  }
}
