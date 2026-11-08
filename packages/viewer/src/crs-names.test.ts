import type { CrsInfo } from '@karmania/engine';
import { describe, expect, it, vi } from 'vitest';
import { CrsNames } from './crs-names.js';

const utm: CrsInfo = { code: 32640, name: 'WGS 84 / UTM zone 40N', kind: 'projected', units: 'm' };

/** A look-up the test answers by hand, and counts. */
function control() {
  const calls: number[] = [];
  const waiting: {
    resolve: (info: CrsInfo | undefined) => void;
    reject: (error: Error) => void;
  }[] = [];
  const lookUp = (code: number): Promise<CrsInfo | undefined> => {
    calls.push(code);
    return new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
    });
  };
  return { calls, waiting, lookUp };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('the names of the coordinate systems', () => {
  it('know nothing until a code has been asked about and answered', async () => {
    const { lookUp, waiting } = control();
    const changed = vi.fn();
    const names = new CrsNames(lookUp, changed);
    expect(names.get(32640)).toBeUndefined();
    names.ask(32640);
    expect(names.get(32640)).toBeUndefined();
    waiting[0]?.resolve(utm);
    await settle();
    expect(names.get(32640)).toEqual(utm);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('ask a code once, while it is being asked and after', async () => {
    const { lookUp, waiting, calls } = control();
    const names = new CrsNames(lookUp, vi.fn());
    names.ask(32640);
    names.ask(32640);
    expect(calls).toEqual([32640]);
    waiting[0]?.resolve(utm);
    await settle();
    names.ask(32640);
    expect(calls).toEqual([32640]);
  });

  it('keep a code that is not in the definitions as null, and not as one to ask again', async () => {
    const { lookUp, waiting, calls } = control();
    const names = new CrsNames(lookUp, vi.fn());
    names.ask(999_999);
    waiting[0]?.resolve(undefined);
    await settle();
    expect(names.get(999_999)).toBeNull();
    names.ask(999_999);
    expect(calls).toEqual([999_999]);
  });

  it('keep each code apart', async () => {
    const { lookUp, waiting } = control();
    const names = new CrsNames(lookUp, vi.fn());
    names.ask(32640);
    names.ask(4326);
    waiting[1]?.resolve({ code: 4326, name: 'WGS 84', kind: 'geographic', units: 'degree' });
    await settle();
    expect(names.get(4326)?.units).toBe('degree');
    expect(names.get(32640)).toBeUndefined();
  });

  it('ask again when the engine could not answer, and say nothing of it', async () => {
    const { lookUp, waiting, calls } = control();
    const changed = vi.fn();
    const names = new CrsNames(lookUp, changed);
    names.ask(32640);
    waiting[0]?.reject(new Error('there is no engine'));
    await settle();
    expect(names.get(32640)).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    names.ask(32640);
    expect(calls).toEqual([32640, 32640]);
  });

  it('forget everything on clear, and ignore an answer that was asked for before it', async () => {
    const { lookUp, waiting, calls } = control();
    const changed = vi.fn();
    const names = new CrsNames(lookUp, changed);
    names.ask(32640);
    names.clear();
    waiting[0]?.resolve(utm);
    await settle();
    expect(names.get(32640)).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    names.ask(32640);
    expect(calls).toEqual([32640, 32640]);
    waiting[1]?.resolve(utm);
    await settle();
    expect(names.get(32640)).toEqual(utm);
    names.clear();
    expect(names.get(32640)).toBeUndefined();
  });
});
