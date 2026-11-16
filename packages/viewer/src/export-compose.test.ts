import { EXPORT_COLOURS, LEGEND_ROW } from '@karmania/scene';
import type { LegendModel } from '@karmania/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recording } from './canvas-recording.js';
import { ComposeError, composeExport } from './export-compose.js';
import type { ComposeEnv, ComposeInput, MapRequest } from './export-compose.js';
import { ExportFontError } from './export-fonts.js';

class FakePath {
  readonly d: string;
  constructor(d: string) {
    this.d = d;
  }
}
beforeEach(() => {
  vi.stubGlobal('Path2D', FakePath);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const swatch = { kind: 'colour', colour: '#e69f00' } as const;
const MODEL: LegendModel = {
  layerCount: 2,
  layerCountLabel: '2 layers',
  entries: [
    {
      type: 'layer',
      id: 'a',
      name: 'Gold',
      visible: true,
      drawn: true,
      swatch,
      classes: [{ label: '10 – 20', count: 1204, countLabel: '1,204', colour: '#e69f00' }],
    },
    { type: 'layer', id: 'b', name: 'Hill', visible: true, drawn: true, swatch, classes: [] },
  ],
};

/** An environment with a canvas that records, and images that are only their size. */
function environment() {
  const made = recording();
  const env: ComposeEnv<{ width: number; height: number }> = {
    createCanvas: (width, height) => ({ canvas: { width, height }, ctx: made.ctx }),
    image: (_rows, width, height) => ({ width, height }) as unknown as ImageData,
  };
  return { env, log: made.log };
}

const input = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  size: { width: 1000, height: 600 },
  dpi: 96,
  legend: MODEL,
  viewMode: '2d',
  camera2d: { centre: [500, 500], unitsPerPixel: 2, heading: 0 },
  camera3d: { target: [500, 500, 0], distance: 400, heading: 0, elevation: 45, fov: 45 },
  heading: 0,
  units: 'm',
  screen: { width: 800, height: 600 },
  fonts: { load: () => Promise.resolve([]), check: () => true },
  renderMap: () => Promise.resolve(),
  ...over,
});

describe('composeExport', () => {
  it('draws the page, then the line round the map, then the map, then the north arrow, the scale bar and the legend: in that order, each over the one before', async () => {
    const { env, log } = environment();
    const requests: MapRequest[] = [];
    await composeExport(
      env,
      input({
        renderMap: (request) => {
          requests.push(request);
          log.push('renderMap');
          request.onBand(new Uint8Array(4), 0, 1);
          return Promise.resolve();
        },
      }),
    );
    const at = (needle: string | RegExp): number =>
      log.findIndex((line) => (typeof needle === 'string' ? line === needle : needle.test(line)));
    const page = at('fillRect(0, 0, 1000, 600)');
    expect(log[page - 1]).toBe(`fillStyle = ${EXPORT_COLOURS.surface}`);
    const frame = at(/^strokeRect\(/);
    const map = at('renderMap');
    const arrow = at('rotate(0)');
    const bar = at(/^fillText\(.* m, /);
    // The legend starts 24 after the map (24 + 728 + 24 = 776), the swatch's room and a gap further in (32), and the middle of its first row (24 + 16) down.
    const legend = at('fillText(Gold, 808, 40)');
    expect(page).toBeGreaterThanOrEqual(0);
    expect(
      [page, frame, map, arrow].every((i, k, all) => i >= 0 && (k === 0 || i > (all[k - 1] ?? 0))),
    ).toBe(true);
    expect(bar).toBeGreaterThan(arrow);
    expect(legend).toBeGreaterThan(bar);
  });

  it('puts the map in the rectangle of the layout inside its line, and the line round it, and asks the renderer for the size of the inside', async () => {
    const { env, log } = environment();
    const requests: MapRequest[] = [];
    const out = await composeExport(
      env,
      input({
        renderMap: (request) => {
          requests.push(request);
          request.onBand(new Uint8Array(4), 0, 3);
          request.onBand(new Uint8Array(4), 3, 5);
          return Promise.resolve();
        },
      }),
    );
    // 1000 by 600, a margin of 24: the legend is "Hill" and the classes of "Gold": 200 wide (the least) and 24 further away. The map is 1000 - 48 - 24 - 200 = 728 wide, 552 high.
    expect(out.layout.map).toEqual({ x: 24, y: 24, width: 728, height: 552 });
    expect(log).toContain('strokeRect(24.5, 24.5, 727, 551)');
    expect(requests).toHaveLength(1);
    expect([requests[0]?.width, requests[0]?.height, requests[0]?.scale]).toEqual([726, 550, 1]);
    // Its bands are put at the inside of the line, the second below the first.
    expect(log).toContain('putImageData(726x3, 25, 25)');
    expect(log).toContain('putImageData(726x5, 25, 28)');
    expect(out.map).toEqual({ x: 25, y: 25, width: 726, height: 550 });
  });

  it('is a picture with no legend when it is given none: the map takes the width, and nothing of the legend is drawn', async () => {
    const { env, log } = environment();
    const requests: MapRequest[] = [];
    const out = await composeExport(
      env,
      input({
        legend: null,
        renderMap: (request) => {
          requests.push(request);
          return Promise.resolve();
        },
      }),
    );
    expect(out.layout.legend).toBeNull();
    expect(out.layout.map.width).toBe(1000 - 48);
    expect(log.some((line) => line.startsWith('fillText(Gold'))).toBe(false);
  });

  it('draws at the scale of the picture: a picture of 300 dpi asks for the map at 3.125 and has lines and rows that size', async () => {
    const { env, log } = environment();
    const requests: MapRequest[] = [];
    await composeExport(
      env,
      input({
        size: { width: 3508, height: 2480 },
        dpi: 300,
        renderMap: (request) => {
          requests.push(request);
          return Promise.resolve();
        },
      }),
    );
    expect(requests[0]?.scale).toBe(3.125);
    // A line of 3 pixels round the map (1 at 96 dpi), a margin of 75 (24), and the first row of the legend 100 high (32): its text is in the middle of it, at 75 + 50.
    expect(log).toContain('lineWidth = 3');
    expect(log.some((line) => /^fillText\(Gold, .*, 125\)$/.test(line))).toBe(true);
  });

  it('gives the renderer cameras that show at least what the screen shows, for the shape of the map in the picture', async () => {
    const { env } = environment();
    const requests: MapRequest[] = [];
    await composeExport(
      env,
      input({
        screen: { width: 1600, height: 400 },
        renderMap: (request) => {
          requests.push(request);
          return Promise.resolve();
        },
      }),
    );
    const camera = requests[0]?.camera2d;
    // The map in the picture is 726 by 550 at scale 1 and the screen 1600 by 400: the width wants the most, 1600 / 726 times the units to a pixel.
    expect(camera?.unitsPerPixel).toBeCloseTo(2 * (1600 / 726), 9);
    expect(camera?.centre).toEqual([500, 500]);
    expect(requests[0]?.camera3d.target).toEqual([500, 500, 0]);
  });

  it('measures the scale bar at the units to a pixel of that camera, and draws it with the label of that length', async () => {
    const { env, log } = environment();
    const out = await composeExport(env, input());
    // 2 metres a pixel, 160 pixels at most: 320 m is the most, so the bar is 200 m, 100 pixels (this map is as wide as the screen's, so the scale is unchanged).
    expect(out.scaleBar).toMatchObject({ kind: 'bar', label: '200 m' });
    // The camera of the picture shows 800 / 726 as much across as the one on screen, so a pixel is that many metres more and the 200 m bar that much shorter: 200 / (2 * 800 / 726).
    expect(out.scaleBar.kind === 'bar' ? out.scaleBar.widthPx : 0).toBeCloseTo(
      200 / ((2 * 800) / 726),
      9,
    );
    expect(out.layout.scaleBar).not.toBeNull();
    expect(log.some((line) => line.startsWith('fillText(200 m'))).toBe(true);
    // At the bottom left of the map, 16 in from its edges.
    expect(out.layout.scaleBar?.x).toBe(out.layout.map.x + 16);
    expect((out.layout.scaleBar?.y ?? 0) + (out.layout.scaleBar?.height ?? 0)).toBe(
      out.layout.map.y + out.layout.map.height - 16,
    );
  });

  it('has no scale bar in 3D, and for a map in degrees, and says why', async () => {
    const { env, log } = environment();
    const three = await composeExport(env, input({ viewMode: '3d' }));
    expect(three.scaleBar).toMatchObject({ kind: 'none', reason: 'three_d' });
    expect(three.layout.scaleBar).toBeNull();
    const degrees = await composeExport(env, input({ units: 'degree' }));
    expect(degrees.scaleBar).toMatchObject({ kind: 'none', reason: 'geographic' });
    expect(log.length).toBeGreaterThan(0);
  });

  it('turns the north arrow by the angle of the heading of the view that is shown', async () => {
    const { env, log } = environment();
    await composeExport(env, input({ heading: 30 }));
    // The needle turns against the map's turn: 30 degrees clockwise of the map is minus 30 for the needle (0.524 radians).
    expect(log).toContain('rotate(-0.524)');
  });

  it('rejects, drawing nothing, when the legend leaves no room for the map', async () => {
    const { env, log } = environment();
    await expect(
      composeExport(env, input({ size: { width: 240, height: 600 } })),
    ).rejects.toMatchObject({
      name: 'ComposeError',
      code: 'no_room_for_map',
    });
    // Nothing is drawn: only the fonts are set, to measure the legend with.
    expect(log.every((line) => line.startsWith('font = '))).toBe(true);
    expect(new ComposeError('no_room_for_map', 'x').code).toBe('no_room_for_map');
  });

  it('rejects with the font error before it draws anything when the font is not there', async () => {
    const { env, log } = environment();
    await expect(
      composeExport(env, input({ fonts: { load: () => Promise.resolve([]), check: () => false } })),
    ).rejects.toBeInstanceOf(ExportFontError);
    expect(log).toEqual([]);
  });

  it('stops when it is aborted: before it starts, and after the map, without drawing the furniture on a map that is not wanted', async () => {
    const { env, log } = environment();
    await expect(composeExport(env, input({ signal: AbortSignal.abort() }))).rejects.toBeDefined();
    expect(log).toEqual([]);
    const controller = new AbortController();
    const later = environment();
    await expect(
      composeExport(
        later.env,
        input({
          signal: controller.signal,
          renderMap: () => {
            controller.abort(new DOMException('Stopped', 'AbortError'));
            return Promise.resolve();
          },
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(later.log.some((line) => line.startsWith('rotate('))).toBe(false);
  });

  it('stops when it is aborted while the fonts are loading, before it makes a canvas', async () => {
    const controller = new AbortController();
    const { env, log } = environment();
    await expect(
      composeExport(
        env,
        input({
          signal: controller.signal,
          fonts: {
            load: () => {
              controller.abort(new DOMException('Stopped', 'AbortError'));
              return Promise.resolve([]);
            },
            check: () => true,
          },
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(log).toEqual([]);
  });

  it('lets what the renderer rejects with through', async () => {
    const { env } = environment();
    await expect(
      composeExport(env, input({ renderMap: () => Promise.reject(new Error('the card said no')) })),
    ).rejects.toThrow('the card said no');
  });

  it('says how far it is, in steps, from the fonts to the end, never going back', async () => {
    const { env } = environment();
    const done: number[] = [];
    await composeExport(
      env,
      input({
        onProgress: (d) => done.push(d),
        renderMap: (request) => {
          request.onProgress?.(0.5);
          request.onProgress?.(1);
          return Promise.resolve();
        },
      }),
    );
    expect(done).toHaveLength(4);
    [0.02, 0.02 + 0.93 * 0.5, 0.95, 1].forEach((expected, k) => {
      expect(done[k]).toBeCloseTo(expected, 12);
    });
  });

  it('has rows in the legend of the heights of the Legend tab', async () => {
    const { env, log } = environment();
    await composeExport(env, input());
    // Hill is a layer after the classes of Gold (32 + 24 under it), so it is 56 below the top row's.
    const ys = log
      .filter((line) => /^fillText\((Gold|Hill), /.test(line))
      .map((line) => Number(line.split(', ').at(-1)?.replace(')', '')));
    expect((ys[1] ?? 0) - (ys[0] ?? 0)).toBe(
      LEGEND_ROW.layer / 2 + LEGEND_ROW.class + LEGEND_ROW.layer / 2,
    );
  });
});
