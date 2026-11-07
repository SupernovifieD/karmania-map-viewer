import type { RenderBuffers } from '@karmania/engine/display';
import { Group } from 'three';
import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { LayerSet } from './layer-set.js';
import type { ClassColouring, FrameInfo, LayerLook } from './look.js';
import type { LayerObject } from './layer-set.js';

const LOOK: LayerLook = {
  visible: true,
  opacity: 1,
  colour: '#e69f00',
  pointSize: 6,
  lineWidth: 2,
};
const INFO: FrameInfo = { pixelRatio: 2, viewport: [800, 600], flat: true, outline: [0, 0, 0] };

const points: RenderBuffers = { kind: 'points', positions: new Float32Array(3) };
const mesh: RenderBuffers = {
  kind: 'mesh',
  positions: new Float32Array(9),
  triangles: new Uint32Array(3),
};

/** A container that says what is in it, and a maker whose layers say when they were freed. */
function setup(drawn: readonly RenderBuffers['kind'][] = ['points']) {
  const inside = new Set<Object3D>();
  const container = {
    add: (object: Object3D) => inside.add(object),
    remove: (object: Object3D) => inside.delete(object),
  };
  const made: {
    object: Group;
    freed: number;
    looks: LayerLook[];
    frames: FrameInfo[];
    classes: (ClassColouring | undefined)[];
  }[] = [];
  const set = new LayerSet(container, (buffers, look): LayerObject | undefined => {
    if (!drawn.includes(buffers.kind)) {
      return undefined;
    }
    const layer = {
      object: new Group(),
      freed: 0,
      looks: [] as LayerLook[],
      frames: [] as FrameInfo[],
      classes: [] as (ClassColouring | undefined)[],
    };
    made.push(layer);
    // The look that the layer is made with is the first it has.
    layer.looks.push(look);
    return {
      object: layer.object,
      dispose: () => {
        layer.freed += 1;
      },
      setLook: (next) => {
        layer.looks.push(next);
      },
      prepareFrame: (info) => {
        layer.frames.push(info);
      },
      // Only a layer of points takes classes here, as only some of the kinds of the renderer will.
      ...(buffers.kind === 'points'
        ? {
            setClasses: (next: ClassColouring | undefined) => {
              layer.classes.push(next);
            },
          }
        : {}),
    };
  });
  return { set, inside, made };
}

describe('LayerSet', () => {
  it('puts the layer of some buffers in the container, under an id', () => {
    const { set, inside, made } = setup();
    expect(set.set('layer-1', points, LOOK)).toBe('drawn');
    expect(set.has('layer-1')).toBe(true);
    expect(set.ids()).toEqual(['layer-1']);
    expect(set.size).toBe(1);
    expect([...inside]).toEqual([made[0]?.object]);
  });

  it('makes the layer with the look it is given, and changes the look of a layer by its id', () => {
    const { set, made } = setup();
    set.set('a', points, LOOK);
    set.set('b', points, { ...LOOK, colour: '#009e73' });
    expect(made.map((layer) => layer.looks)).toEqual([[LOOK], [{ ...LOOK, colour: '#009e73' }]]);
    const hidden = { ...LOOK, visible: false, opacity: 0.25 };
    expect(set.setLook('a', hidden)).toBe(true);
    expect(set.setLook('never', hidden)).toBe(false);
    expect(made[0]?.looks).toEqual([LOOK, hidden]);
    expect(made[1]?.looks).toHaveLength(1);
  });

  it('tells each layer what is true of the screen before a frame, and not a layer that was removed', () => {
    const { set, made } = setup();
    set.set('a', points, LOOK);
    set.set('b', points, LOOK);
    set.remove('b');
    set.prepareFrame(INFO);
    expect(made[0]?.frames).toEqual([INFO]);
    expect(made[1]?.frames).toEqual([]);
  });

  it('replaces a layer when its buffers come again: the old one is taken out and freed, once', () => {
    const { set, inside, made } = setup();
    set.set('layer-1', points, LOOK);
    set.set('layer-1', points, LOOK);
    expect(made).toHaveLength(2);
    expect(made.map((layer) => layer.freed)).toEqual([1, 0]);
    expect([...inside]).toEqual([made[1]?.object]);
    expect(set.size).toBe(1);
  });

  it('takes a layer away, frees it once, and says whether there was one', () => {
    const { set, inside, made } = setup();
    set.set('layer-1', points, LOOK);
    expect(set.remove('layer-1')).toBe(true);
    expect(set.remove('layer-1')).toBe(false);
    expect(made[0]?.freed).toBe(1);
    expect(inside.size).toBe(0);
    expect(set.has('layer-1')).toBe(false);
    expect(set.remove('never')).toBe(false);
  });

  it('has no layer for buffers of a kind that is not drawn, and loses the one that was there', () => {
    const { set, inside, made } = setup(['points']);
    expect(set.set('layer-1', mesh, LOOK)).toBe('unsupported');
    expect(set.size).toBe(0);
    expect(made).toHaveLength(0);
    set.set('layer-2', points, LOOK);
    expect(set.set('layer-2', mesh, LOOK)).toBe('unsupported');
    expect(set.has('layer-2')).toBe(false);
    expect(made[0]?.freed).toBe(1);
    expect(inside.size).toBe(0);
  });

  it('builds a layer a part at a time while it says that there is more, and stops asking once it is done', () => {
    const container = { add: () => undefined, remove: () => undefined };
    const calls: string[] = [];
    const left = { a: 2, b: 1 };
    const set = new LayerSet(container, (buffers) => {
      if (buffers.kind === 'mesh') {
        return {
          object: new Group(),
          dispose: () => undefined,
          setLook: () => undefined,
          prepareFrame: () => undefined,
        };
      }
      return {
        object: new Group(),
        dispose: () => undefined,
        setLook: () => undefined,
        prepareFrame: () => undefined,
        step: () => {
          const name = buffers.kind === 'points' && buffers.positions.length === 3 ? 'a' : 'b';
          calls.push(name);
          left[name] -= 1;
          return left[name] > 0;
        },
      };
    });
    set.set('a', points, LOOK);
    set.set('b', { kind: 'points', positions: new Float32Array(6) }, LOOK);
    // A layer that is made whole has no `step` and costs nothing.
    set.set('whole', mesh, LOOK);
    expect(set.step()).toBe(true);
    expect(calls).toEqual(['a', 'b']);
    expect(set.step()).toBe(false);
    expect(calls).toEqual(['a', 'b', 'a']);
    // Nothing is left, so nothing is asked.
    expect(set.step()).toBe(false);
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it('stops building a layer that is removed or replaced', () => {
    const container = { add: () => undefined, remove: () => undefined };
    let steps = 0;
    const set = new LayerSet(container, () => ({
      object: new Group(),
      dispose: () => undefined,
      setLook: () => undefined,
      prepareFrame: () => undefined,
      step: () => {
        steps += 1;
        return true;
      },
    }));
    set.set('a', points, LOOK);
    expect(set.step()).toBe(true);
    set.remove('a');
    expect(set.step()).toBe(false);
    expect(steps).toBe(1);
    set.set('b', points, LOOK);
    set.set('b', points, LOOK);
    expect(set.step()).toBe(true);
    expect(steps).toBe(2);
  });

  it('keeps the layers apart by id and in the order they were put, and clears them all', () => {
    const { set, inside, made } = setup();
    set.set('b', points, LOOK);
    set.set('a', points, LOOK);
    set.set('c', points, LOOK);
    expect(set.ids()).toEqual(['b', 'a', 'c']);
    set.remove('a');
    expect(set.ids()).toEqual(['b', 'c']);
    set.clear();
    expect(set.size).toBe(0);
    expect(inside.size).toBe(0);
    expect(made.map((layer) => layer.freed)).toEqual([1, 1, 1]);
    // Clearing nothing is fine, and frees nothing twice.
    set.clear();
    expect(made.map((layer) => layer.freed)).toEqual([1, 1, 1]);
  });

  it('colours the elements of a layer that is coloured by classes, and takes the colouring away', () => {
    const { set, made } = setup(['points', 'mesh']);
    set.set('layer-1', points, LOOK);
    const classes: ClassColouring = {
      indices: Uint8Array.of(0, 1, 255),
      colours: ['#112233', '#445566'],
    };
    expect(set.setClasses('layer-1', classes)).toBe(true);
    expect(set.setClasses('layer-1', undefined)).toBe(true);
    expect(made[0]?.classes).toEqual([classes, undefined]);
  });

  it('says that there is no layer to colour, or that the layer is not coloured by classes, and does nothing else', () => {
    const { set, made } = setup(['points', 'mesh']);
    const classes: ClassColouring = { indices: Uint8Array.of(0), colours: ['#112233'] };
    expect(set.setClasses('never', classes)).toBe(false);
    set.set('layer-1', mesh, LOOK);
    expect(set.setClasses('layer-1', classes)).toBe(false);
    expect(made[0]?.classes).toEqual([]);
  });

  it('has a layer that is put in place of another without the colouring that the old one had', () => {
    const { set, made } = setup();
    set.set('layer-1', points, LOOK);
    set.setClasses('layer-1', { indices: Uint8Array.of(0), colours: ['#112233'] });
    set.set('layer-1', points, LOOK);
    expect(made[0]?.classes).toHaveLength(1);
    expect(made[1]?.classes).toEqual([]);
  });
});
