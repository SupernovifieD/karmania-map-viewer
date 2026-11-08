import type { CrsInfo } from '@karmania/engine';
import type { CrsLookup } from './datasets.js';

/**
 * What the definitions say of the EPSG codes the viewer has asked about, for the units of the scale bar and the name in the status
 * chip's tooltip. A code is asked once: the answer (the system, or `null` for a code that is not in the definitions) is kept, and
 * `changed` is called when one arrives, so that what shows it is made again. If the engine cannot answer (there is none yet, or
 * the request fails), nothing is kept, and the code is asked again the next time it is wanted.
 */
export class CrsNames {
  private readonly known = new Map<number, CrsInfo | null>();
  /** The codes that have been asked about and not given up on: answered, or still being asked. */
  private readonly asked = new Set<number>();
  private generation = 0;

  constructor(
    /** What gives the engine's answer; it may reject when there is no engine. */
    private readonly lookUp: CrsLookup,
    /** Called when an answer has come. */
    private readonly changed: () => void,
  ) {}

  /** What the definitions say of `code`: the system, `null` if it is not in them, `undefined` while it has not been asked or is being asked. */
  get(code: number): CrsInfo | null | undefined {
    return this.known.get(code);
  }

  /** Asks about `code`, if that has not been done. */
  ask(code: number): void {
    if (this.asked.has(code)) {
      return;
    }
    this.asked.add(code);
    const generation = this.generation;
    this.lookUp(code).then(
      (info) => {
        // An answer to a question asked before a `clear` is the answer of an engine that is gone.
        if (generation !== this.generation) {
          return;
        }
        this.known.set(code, info ?? null);
        this.changed();
      },
      () => {
        if (generation === this.generation) {
          this.asked.delete(code);
        }
      },
    );
  }

  /** Forgets everything, and what was being asked: the engine is gone, and another may say otherwise. */
  clear(): void {
    this.generation += 1;
    this.known.clear();
    this.asked.clear();
  }
}
