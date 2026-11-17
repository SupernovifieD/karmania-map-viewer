import type { Engine } from '@karmania/engine';
import { describe, expect, it } from 'vitest';
import { holdImport, isHeldBack, onHeldBackChange, shownOf } from './pending-imports.js';

interface Row {
  readonly id: number;
}

/** An engine that holds what the test says it does, and is only asked for the list. */
function engineHolding(...ids: number[]): { engine: Engine; hold: (...more: number[]) => void } {
  const held: Row[] = ids.map((id) => ({ id }));
  const engine = { datasets: () => [...held] } as unknown as Engine;
  return {
    engine,
    hold: (...more) => {
      held.push(...more.map((id) => ({ id })));
    },
  };
}

const rows = (...ids: number[]): readonly Row[] => ids.map((id) => ({ id }));
const idsOf = (list: readonly Row[]): number[] => list.map((row) => row.id);

describe('what an import wizard has loaded and nobody has kept', () => {
  it('holds back nothing while no import is going on, and gives the list it was given', () => {
    const { engine } = engineHolding(1, 2);
    const list = rows(1, 2);
    expect(isHeldBack(engine, 1)).toBe(false);
    expect(shownOf(engine, list, [])).toBe(list);
  });

  it('holds back what arrives while the import runs and does not know yet what it loaded, and not what was there before', () => {
    const { engine, hold } = engineHolding(1);
    holdImport(engine);
    hold(2);
    expect(isHeldBack(engine, 1)).toBe(false);
    expect(isHeldBack(engine, 2)).toBe(true);
    expect(idsOf(shownOf(engine, rows(1, 2), rows(1)))).toEqual([1]);
  });

  it('holds back what the import says it loaded, and shows what else came meanwhile, and tells of it', () => {
    const { engine, hold } = engineHolding(1);
    const told: string[] = [];
    onHeldBackChange(engine, () => told.push('changed'));
    const run = holdImport(engine);
    // Another viewer of the engine loads 2 while the import goes on, and the import loads 3.
    hold(2, 3);
    expect(idsOf(shownOf(engine, rows(1, 2, 3), rows(1)))).toEqual([1]);
    run.loaded([3]);
    expect(told).toEqual(['changed']);
    expect(isHeldBack(engine, 2)).toBe(false);
    expect(isHeldBack(engine, 3)).toBe(true);
    expect(idsOf(shownOf(engine, rows(1, 2, 3), rows(1)))).toEqual([1, 2]);
  });

  it('shows what it held back when it is released, and tells of it once, however many times it is released', () => {
    const { engine, hold } = engineHolding();
    let told = 0;
    onHeldBackChange(engine, () => {
      told += 1;
    });
    const run = holdImport(engine);
    hold(1);
    run.loaded([1]);
    told = 0;
    run.release();
    run.release();
    expect(told).toBe(1);
    expect(isHeldBack(engine, 1)).toBe(false);
    expect(idsOf(shownOf(engine, rows(1), []))).toEqual([1]);
  });

  it('is not changed, and tells no one, by what a run says after it was released', () => {
    const { engine, hold } = engineHolding();
    let told = 0;
    onHeldBackChange(engine, () => {
      told += 1;
    });
    const run = holdImport(engine);
    run.release();
    expect(told).toBe(1);
    hold(1);
    run.loaded([1]);
    expect(isHeldBack(engine, 1)).toBe(false);
    expect(told).toBe(1);
  });

  it('holds back what any of the runs of one engine holds back', () => {
    const { engine, hold } = engineHolding();
    const first = holdImport(engine);
    const second = holdImport(engine);
    hold(1, 2);
    first.loaded([1]);
    second.loaded([2]);
    expect(isHeldBack(engine, 1)).toBe(true);
    expect(isHeldBack(engine, 2)).toBe(true);
    first.release();
    expect(isHeldBack(engine, 1)).toBe(false);
    expect(isHeldBack(engine, 2)).toBe(true);
  });

  it('keeps the engines apart: what one holds back, another shows', () => {
    const one = engineHolding();
    const other = engineHolding();
    holdImport(one.engine);
    one.hold(1);
    other.hold(1);
    expect(isHeldBack(one.engine, 1)).toBe(true);
    expect(isHeldBack(other.engine, 1)).toBe(false);
  });

  it('gives back the list that is shown when what should be shown is the same datasets, not another array of them', () => {
    const { engine } = engineHolding(1, 2);
    const run = holdImport(engine);
    run.loaded([2]);
    const one = { id: 1 };
    const current = [one];
    // The engine tells of 2, which is held back: what should be shown is `one` again, which is what is shown.
    expect(shownOf(engine, [one, { id: 2 }], current)).toBe(current);
    // The same number but not the same dataset (it was made again): it is another list.
    const other = shownOf(engine, [{ id: 1 }], current);
    expect(other).not.toBe(current);
    expect(idsOf(other)).toEqual([1]);
  });

  it('can begin on an engine that has been let go, which then says so to the import and not to the hold', () => {
    const gone = {
      datasets: () => {
        throw new Error('The engine has been disposed.');
      },
    } as unknown as Engine;
    const run = holdImport(gone);
    run.loaded([1]);
    run.release();
    expect(isHeldBack(gone, 1)).toBe(false);
  });

  it('stops telling when a listener is taken off, which may be done twice', () => {
    const { engine } = engineHolding();
    let told = 0;
    const stop = onHeldBackChange(engine, () => {
      told += 1;
    });
    stop();
    stop();
    holdImport(engine).release();
    expect(told).toBe(0);
  });
});
