import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { combineLayers } from './layer-combine.js';
import type { LayerObject } from './layer-set.js';
import type { FrameInfo, LayerLook } from './look.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 0.6,
  colour: '#56b4e9',
  pointSize: 6,
  lineWidth: 2,
};
const INFO: FrameInfo = { pixelRatio: 2, viewport: [800, 600], flat: true, outline: [0, 0, 0] };

/** A part that says what it was told, and that takes `parts` steps to build when it has any. */
function part(name: string, parts = 0) {
  const told: string[] = [];
  const looks: LayerLook[] = [];
  let left = parts;
  const layer: LayerObject = {
    object: new Group(),
    dispose: () => {
      told.push(`${name} disposed`);
    },
    setLook: (look) => {
      looks.push(look);
    },
    prepareFrame: () => {
      told.push(`${name} frame`);
    },
    ...(parts > 0
      ? {
          step: () => {
            told.push(`${name} step`);
            left -= 1;
            return left > 0;
          },
        }
      : {}),
  };
  return { layer, told, looks };
}

describe('combineLayers', () => {
  it('has the objects of its parts in one group, in the order they are drawn', () => {
    const [a, b] = [part('a'), part('b')];
    const combined = combineLayers({ parts: [a.layer, b.layer], lookOf: (_, look) => look });
    expect(combined.object.children).toEqual([a.layer.object, b.layer.object]);
  });

  it('gives each part the look that is made for it from the look of the layer', () => {
    const [a, b] = [part('a'), part('b')];
    const combined = combineLayers({
      parts: [a.layer, b.layer],
      lookOf: (index, look) => (index === 0 ? look : { ...look, opacity: 1, lineWidth: 1 }),
    });
    combined.setLook(LOOK);
    expect(a.looks).toEqual([LOOK]);
    expect(b.looks).toEqual([{ ...LOOK, opacity: 1, lineWidth: 1 }]);
  });

  it('tells every part what is true of the frame, and frees every part, and its group, when it is disposed', () => {
    const [a, b] = [part('a'), part('b')];
    const combined = combineLayers({ parts: [a.layer, b.layer], lookOf: (_, look) => look });
    combined.prepareFrame(INFO);
    combined.dispose();
    expect([...a.told, ...b.told]).toEqual(['a frame', 'a disposed', 'b frame', 'b disposed']);
    expect(combined.object.children).toHaveLength(0);
  });

  it('has nothing to step if no part has', () => {
    const combined = combineLayers({
      parts: [part('a').layer, part('b').layer],
      lookOf: (_, look) => look,
    });
    expect('step' in combined).toBe(false);
  });

  it('steps the parts that are being built until each is done, and is being built while any is', () => {
    const [a, b, c] = [part('a', 2), part('b'), part('c', 1)];
    const combined = combineLayers({
      parts: [a.layer, b.layer, c.layer],
      lookOf: (_, look) => look,
    });
    expect(combined.step?.()).toBe(true);
    expect(combined.step?.()).toBe(false);
    expect(combined.step?.()).toBe(false);
    // `a` took two steps and `c` one, and none is asked after it said it was done; `b` has nothing to build.
    expect(a.told.filter((line) => line === 'a step')).toHaveLength(2);
    expect(c.told.filter((line) => line === 'c step')).toHaveLength(1);
    expect(b.told).toEqual([]);
  });
});
