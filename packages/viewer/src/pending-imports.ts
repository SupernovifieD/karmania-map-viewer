import type { Engine } from '@karmania/engine';

/**
 * What an import wizard has loaded into an engine to say what it found, and that nobody has kept yet.
 *
 * The wizard's last step loads the file as soon as it is shown, so that it can say what is in it, and takes it out again if the person goes back or cancels. Until
 * the person keeps it, it is not something to show: a viewer that drew it, listed it and told its page of it would show data that nobody chose, which may be gone in a
 * moment (and is a long frame for the page when it is large). The engine has it, as it has whatever is loaded into it; the viewers of the engine do not show it.
 */

/** One run of a wizard's import, which holds back what it loads. */
export interface ImportHold {
  /** The run has loaded these datasets: from now on they, and no others, are what it holds back. */
  loaded(ids: readonly number[]): void;
  /** The run is over: what it loaded was kept or taken out, or it loaded nothing. What it held back is shown, if the engine still has it. */
  release(): void;
}

interface Run {
  /** What the engine held when the run began: until the run knows what it loaded, whatever has come since is taken to be its. */
  readonly before: ReadonlySet<number>;
  /** What the run loaded, once it knows. */
  ids: ReadonlySet<number> | undefined;
}

interface Holds {
  readonly runs: Set<Run>;
  readonly listeners: Set<() => void>;
}

const holds = new WeakMap<Engine, Holds>();

function holdsOf(engine: Engine): Holds {
  let found = holds.get(engine);
  if (found === undefined) {
    found = { runs: new Set(), listeners: new Set() };
    holds.set(engine, found);
  }
  return found;
}

function tell(found: Holds): void {
  for (const listener of [...found.listeners]) {
    listener();
  }
}

/** What the engine holds now, by number; none if it has been let go (the import that follows says so). */
function heldNow(engine: Engine): ReadonlySet<number> {
  try {
    return new Set(engine.datasets().map((dataset) => dataset.id));
  } catch {
    return new Set();
  }
}

/** Begins holding back what a wizard's import loads into `engine`, until `release`. */
export function holdImport(engine: Engine): ImportHold {
  const found = holdsOf(engine);
  const run: Run = { before: heldNow(engine), ids: undefined };
  found.runs.add(run);
  return {
    loaded(ids) {
      if (found.runs.has(run)) {
        run.ids = new Set(ids);
        // What came meanwhile, and is not the run's, is shown now.
        tell(found);
      }
    },
    release() {
      if (found.runs.delete(run)) {
        tell(found);
      }
    },
  };
}

/** Whether a wizard of this engine has loaded the dataset, and has not been told to keep it. */
export function isHeldBack(engine: Engine, id: number): boolean {
  for (const run of holdsOf(engine).runs) {
    if (run.ids === undefined ? !run.before.has(id) : run.ids.has(id)) {
      return true;
    }
  }
  return false;
}

/**
 * What a viewer shows of what the engine holds, which is all of it but what is held back. `current` is what it shows now: if that is the same list of the same
 * datasets, it is given back and not another array of them, so that a viewer that shows nothing new is not drawn again (an engine tells of a dataset that is held
 * back, and a viewer's list is the same as before).
 */
export function shownOf<T extends { readonly id: number }>(
  engine: Engine,
  list: readonly T[],
  current: readonly T[],
): readonly T[] {
  const wanted =
    holdsOf(engine).runs.size === 0 ? list : list.filter((item) => !isHeldBack(engine, item.id));
  return wanted.length === current.length && wanted.every((item, at) => item === current[at])
    ? current
    : wanted;
}

/** Calls `listener` when what is held back changes, so that what a viewer shows may be another list. Gives the way to stop. */
export function onHeldBackChange(engine: Engine, listener: () => void): () => void {
  const found = holdsOf(engine);
  found.listeners.add(listener);
  return () => {
    found.listeners.delete(listener);
  };
}
