import type { ColumnSummary, Kind } from '@karmania/engine/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { COMMAND_TYPES, applyCommand, type Command } from './commands.js';
import { emptyScene } from './empty.js';
import { SAMPLE_FRAME, frozen, layerById, sampleScene } from './test-support/documents.js';
import type { SceneDocument, VerticalExaggeration, ViewMode } from './types.js';
import type { StylePatch } from './commands-style.js';
import { validateScene } from './validate.js';

describe('the commands as values', () => {
  it('are listed, each once, and the list is every kind that a Command can be', () => {
    expectTypeOf<(typeof COMMAND_TYPES)[number]>().toEqualTypeOf<Command['type']>();
    expect(new Set(COMMAND_TYPES).size).toBe(COMMAND_TYPES.length);
    expect(COMMAND_TYPES).toHaveLength(16);
  });

  it('do what the function of the same name does, for every kind, and give the same document when it changes nothing', () => {
    const doc = sampleScene();
    const dataset = { id: 5, name: 'Wells', kind: 'points' as const, elementCount: 3, columns: [] };
    const commands: Command[] = [
      { type: 'addLayers', datasets: [dataset] },
      { type: 'removeLayersOfDataset', datasetId: 2 },
      { type: 'setVisible', layerId: 'layer-2', visible: true },
      { type: 'setGroupVisible', groupId: 'group-1', visible: false },
      { type: 'moveNode', id: 'layer-1', to: { parent: 'group-1', index: 0 } },
      { type: 'createGroup', name: 'New' },
      { type: 'createGroup', name: 'New', index: 1 },
      { type: 'renameGroup', groupId: 'group-1', name: 'Renamed' },
      { type: 'deleteGroup', groupId: 'group-1' },
      { type: 'setGroupCollapsed', groupId: 'group-1', collapsed: true },
      { type: 'setStyle', layerId: 'layer-2', patch: { opacity: 0.5 } },
      {
        type: 'setContours',
        layerId: 'layer-2',
        contours: { interval: 5, base: 0, indexEvery: 5, visible: true },
      },
      { type: 'setViewMode', mode: '2d' },
      { type: 'setVerticalExaggeration', factor: 10 },
      { type: 'setCamera', patch: { camera2d: { unitsPerPixel: 3 } } },
      { type: 'setFrame', frame: { ...SAMPLE_FRAME, origin: [513000, 4012000, 0] } },
      { type: 'setSelection', selection: { layerId: 'layer-1', element: 7 } },
    ];
    expect(new Set(commands.map((c) => c.type)).size).toBe(COMMAND_TYPES.length);
    for (const command of commands) {
      const next = applyCommand(doc, command);
      expect(next, command.type).not.toBe(doc);
      expect(validateScene(next), command.type).toEqual([]);
    }
    const nothing: Command[] = [
      { type: 'addLayers', datasets: [] },
      { type: 'removeLayersOfDataset', datasetId: 99 },
      { type: 'setVisible', layerId: 'layer-9', visible: true },
      { type: 'moveNode', id: 'layer-9', to: { parent: null, index: 0 } },
      { type: 'setStyle', layerId: 'layer-2', patch: { opacity: 3 } },
      { type: 'setViewMode', mode: '3d' },
      { type: 'setCamera', patch: {} },
      { type: 'setSelection', selection: { layerId: 'layer-2', element: 0 } },
    ];
    for (const command of nothing) {
      expect(applyCommand(doc, command), command.type).toBe(doc);
    }
  });

  it('are refused, with a TypeError, when the kind is one that there is not', () => {
    expect(() => applyCommand(sampleScene(), { type: 'explode' } as unknown as Command)).toThrow(
      TypeError,
    );
    expect(() => applyCommand(sampleScene(), {} as unknown as Command)).toThrow(
      /no command of the kind/,
    );
    expect(() =>
      applyCommand(sampleScene(), { type: 'constructor' } as unknown as Command),
    ).toThrow(TypeError);
  });
});

/** A small random number generator, so that the run below is the same every time (mulberry32). */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A command made of values that are often right and often wrong, naming layers and groups that are often there. */
function randomCommand(doc: SceneDocument, next: () => number): Command {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const layerIds = [...Object.keys(doc.layers), 'layer-99', 'constructor', ''];
  const groupIds = [
    ...doc.legend.flatMap((n) => (n.type === 'group' ? [n.id] : [])),
    'group-99',
    'layer-1',
  ];
  const kinds: Kind[] = ['points', 'lines', 'polygons', 'mesh', 'grid', 'blocks'];
  const column = (): ColumnSummary => ({
    name: pick(['a', 'b']),
    type: pick(['float', 'int', 'text', 'bool']),
    nullCount: pick([0, 0, 10]),
  });
  const number = (): number =>
    pick([0, 1, 2, 5, 10, 24, 100, -1, 0.5, 1.5, 360, 725, NaN, Infinity]);
  const text = (): string => pick(['', ' ', 'x', ' Name ', '#abcdef', '#ABCDEF', 'red']);
  switch (Math.floor(next() * 16)) {
    case 0:
      return {
        type: 'addLayers',
        datasets: Array.from({ length: Math.floor(next() * 3) }, () => ({
          // Mostly datasets as the engine gives them, and now and then one that is not (it refuses them all).
          id: pick([0, 1, 2, 3, 4, 5, 1, 2, 3, -1, 1.5, NaN]),
          name: text(),
          kind: pick([...kinds, ...kinds, 'bogus' as Kind]),
          elementCount: 10,
          columns: [column(), column()],
        })),
      };
    case 1:
      return { type: 'removeLayersOfDataset', datasetId: Math.floor(next() * 7) };
    case 2:
      return { type: 'setVisible', layerId: pick(layerIds), visible: next() < 0.5 };
    case 3:
      return { type: 'setGroupVisible', groupId: pick(groupIds), visible: next() < 0.5 };
    case 4:
      return {
        type: 'moveNode',
        id: pick([...layerIds, ...groupIds]),
        to: { parent: pick([null, null, ...groupIds]), index: number() },
      };
    case 5:
      return { type: 'createGroup', name: text(), index: number() };
    case 6:
      return { type: 'renameGroup', groupId: pick(groupIds), name: text() };
    case 7:
      return { type: 'deleteGroup', groupId: pick(groupIds) };
    case 8:
      return { type: 'setGroupCollapsed', groupId: pick(groupIds), collapsed: next() < 0.5 };
    case 9:
      return {
        type: 'setStyle',
        layerId: pick(layerIds),
        patch: pick<StylePatch>([
          { opacity: number() },
          { pointSize: number() },
          { lineWidth: number() },
          { colour: { mode: 'single' as const, value: text() } },
          {
            colour: {
              mode: 'classes' as const,
              column: text(),
              method: pick(['equal', 'jenks', 'median']) as 'equal',
              classes: number(),
              ramp: pick(['viridis', 'rainbow', 'okabe-ito']),
              reverse: next() < 0.5,
            },
          },
        ]),
      };
    case 10:
      return {
        type: 'setContours',
        layerId: pick(layerIds),
        contours: pick([
          null,
          { interval: number(), base: number(), indexEvery: number(), visible: next() < 0.5 },
        ]),
      };
    case 11:
      return { type: 'setViewMode', mode: pick(['2d', '3d', 'x']) as ViewMode };
    case 12:
      return {
        type: 'setVerticalExaggeration',
        factor: pick([1, 2, 3, 5, 10, 4, NaN]) as VerticalExaggeration,
      };
    case 13:
      return {
        type: 'setCamera',
        patch: pick([
          {
            camera2d: {
              centre: [number(), number()] as const,
              unitsPerPixel: number(),
              heading: number(),
            },
          },
          {
            camera3d: {
              target: [number(), number(), number()] as const,
              distance: number(),
              heading: number(),
              elevation: number(),
              fov: number(),
            },
          },
          {},
        ]),
      };
    case 14:
      return {
        type: 'setFrame',
        frame: pick([
          null,
          SAMPLE_FRAME,
          {
            mapCrs: { kind: 'epsg' as const, code: Math.floor(next() * 3) * 100 },
            origin: [number(), 0, 0] as const,
            source: pick(['auto', 'user'] as const),
          },
          {
            mapCrs: { kind: 'local' as const, units: pick(['m', 'ft', 'km'] as never) },
            origin: [0, 0, 0] as const,
            source: 'auto' as const,
          },
        ]),
      };
    default:
      return {
        type: 'setSelection',
        selection: pick([null, { layerId: pick(layerIds), element: number() }]),
      };
  }
}

describe('a run of commands, right and wrong, in any order', () => {
  it('never makes a document that validateScene refuses, and never changes one that it was given', () => {
    // The scene a viewer starts with, and one whose ids are awkward: a layer called like a group, a group called like a
    // layer, a layer in a group, and a number that a double cannot hold.
    const awkward: SceneDocument = {
      ...emptyScene(),
      layers: {
        'group-1': { ...layerById(sampleScene(), 'layer-2'), id: 'group-1' },
        'layer-9007199254740993': {
          ...layerById(sampleScene(), 'layer-2'),
          id: 'layer-9007199254740993',
        },
      },
      legend: [
        { type: 'group', id: 'layer-3', name: 'Odd', collapsed: false, children: ['group-1'] },
        { type: 'layer', id: 'layer-9007199254740993' },
      ],
    };
    expect(validateScene(awkward)).toEqual([]);
    for (const [seed, start] of [
      [1, emptyScene()],
      [2, emptyScene()],
      [3, emptyScene()],
      [4, emptyScene()],
      [5, awkward],
      [6, awkward],
      [7, awkward],
    ] as const) {
      const next = generator(seed);
      let doc: SceneDocument = frozen(start);
      let changed = 0;
      for (let step = 0; step < 1000; step += 1) {
        const command = randomCommand(doc, next);
        const after = applyCommand(doc, command);
        if (after !== doc) {
          changed += 1;
        }
        const problems = validateScene(after);
        expect(
          problems,
          `seed ${String(seed)} step ${String(step)} ${JSON.stringify(command)}`,
        ).toEqual([]);
        doc = frozen(after);
      }
      // The run is not all refused commands: a good share of them did something.
      expect(changed, `seed ${String(seed)}`).toBeGreaterThan(150);
    }
  });
});
