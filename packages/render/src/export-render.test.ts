import { Color, Scene, WebGLRenderTarget } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GL_OUT_OF_MEMORY, ExportError, createExporter } from './export-render.js';
import type { ExportGl, ExportHost, ExportRenderOptions } from './export-render.js';
import type { FrameInfo } from './look.js';

const CAMERA_2D = { centre: [100, 200], unitsPerPixel: 0.5, heading: 0 } as const;
const CAMERA_3D = {
  target: [100, 200, 10],
  distance: 300,
  heading: 30,
  elevation: 40,
  fov: 45,
} as const;

interface Fake {
  readonly host: ExportHost;
  readonly log: string[];
  readonly infos: FrameInfo[];
  readonly clears: { colour: [number, number, number]; alpha: number; bound: boolean }[];
  state: { status: 'ok' | 'lost' | 'disposed'; revision: number; viewMode: '2d' | '3d' };
}

/**
 * A host with no card: it records what the export does, and fails the test at once if the export does what it must not (an await while the target is bound, a
 * draw that is not told what is true first, programs made with no target bound).
 */
function fake(
  overrides: Partial<ExportHost> = {},
  names: readonly string[] = ['a', 'b'],
  mode: '2d' | '3d' = '2d',
): Fake {
  const log: string[] = [];
  const infos: FrameInfo[] = [];
  const clears: Fake['clears'] = [];
  const state: Fake['state'] = { status: 'ok', revision: 1, viewMode: mode };
  let bound = false;
  let prepared = false;
  let colour = new Color(0.1, 0.2, 0.3);
  const scenes = names.map((id) => ({ id, scene: Object.assign(new Scene(), { name: id }) }));
  const notBound = (what: string): void => {
    if (bound) {
      throw new Error(`${what} while the target is bound`);
    }
  };
  const gl: ExportGl = {
    setRenderTarget(target) {
      bound = target !== null;
      prepared = bound && prepared;
      log.push(target === null ? 'unbind' : 'bind');
    },
    compileAsync(scene) {
      if (!bound) {
        throw new Error('programs made with no target bound');
      }
      log.push(`compile ${scene.name}`);
      return Promise.resolve(scene);
    },
    render(scene) {
      if (!bound || !prepared) {
        throw new Error('drawn without a target, or without the layers being told first');
      }
      log.push(`render ${scene.name}`);
    },
    clear() {
      log.push('clear');
    },
    clearDepth() {
      log.push('clearDepth');
    },
    getClearColor(target) {
      return target.copy(colour);
    },
    getClearAlpha: () => 0.25,
    setClearColor(next, alpha = 1) {
      colour = next.clone();
      clears.push({ colour: [next.r, next.g, next.b], alpha, bound });
      log.push(`clearColour ${bound ? 'bound' : 'unbound'}`);
    },
  };
  const host: ExportHost = {
    gl,
    view: () => ({
      viewMode: state.viewMode,
      origin: [0, 0, 0],
      extent: null,
      depth: { min: 0, max: 20 },
      verticalExaggeration: 1,
    }),
    layers: () => scenes,
    place: () => undefined,
    prepare(info) {
      infos.push(info);
      log.push('prepare');
      prepared = true;
    },
    settle: () => {
      notBound('settled');
      log.push('settle');
      return Promise.resolve();
    },
    revision: () => state.revision,
    status: () => state.status,
    limits: () => ({ renderbuffer: 8192, texture: 8192, viewport: 8192, pointSize: 64 }),
    largestPoint: () => 6,
    error: () => 0,
    read: (_target, y, rows, into) => {
      notBound('read');
      log.push(`read ${String(y)} ${String(rows)}`);
      into.fill(7);
      return Promise.resolve();
    },
    yieldTask: () => {
      notBound('yielded');
      log.push('yield');
      return Promise.resolve();
    },
    ...overrides,
  };
  // What is told where a layer is happens inside a slice, with the target bound: it is only noted.
  host.place = (id) => {
    log.push(`place ${id}`);
  };
  return { host, log, infos, clears, state };
}

const options = (over: Partial<ExportRenderOptions> = {}): ExportRenderOptions => ({
  width: 4,
  height: 6,
  scale: 2,
  viewMode: '2d',
  camera2d: CAMERA_2D,
  camera3d: CAMERA_3D,
  background: [233, 236, 240],
  ink: [26, 29, 33],
  onBand: () => undefined,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the export of the map', () => {
  it('makes the programs with the target bound, then clears and draws each layer in a slice of its own that is told what is true first, never waiting while the target is bound', async () => {
    const { host, log } = fake();
    await createExporter(host)(options());
    expect(log).toEqual([
      'settle',
      // The programs: told first, each made with the target bound.
      'prepare',
      'bind',
      'compile a',
      'unbind',
      'bind',
      'compile b',
      'unbind',
      // The clear is a slice; and then each layer, with the depth cleared before it in 2D.
      'prepare',
      'bind',
      'clearColour bound',
      'clear',
      'unbind',
      'prepare',
      'bind',
      'place a',
      'clearDepth',
      'render a',
      'unbind',
      'yield',
      'prepare',
      'bind',
      'place b',
      'clearDepth',
      'render b',
      'unbind',
      'yield',
      'read 0 6',
      // And the screen's clear colour is put back last, with no target bound.
      'clearColour unbound',
    ]);
  });

  it('draws at the scale of the picture, in the viewport of its size, with the outline of the light theme, and flat in 2D', async () => {
    const { host, infos } = fake();
    await createExporter(host)(options({ width: 400, height: 300, scale: 3.125 }));
    for (const info of infos) {
      expect(info.pixelRatio).toBe(3.125);
      expect(info.viewport).toEqual([400, 300]);
      expect(info.flat).toBe(true);
      expect(info.light).toEqual([0, 0, 1]);
      expect(info.outline[0]).toBeCloseTo(26 / 255, 12);
      expect(info.outline[2]).toBeCloseTo(33 / 255, 12);
    }
  });

  it('is lit by the light of the world as the export’s own camera sees it in 3D, and does not clear the depth between layers', async () => {
    const { host, infos, log } = fake({}, ['a', 'b'], '3d');
    await createExporter(host)(options({ viewMode: '3d' }));
    const light = infos[0]?.light ?? [0, 0, 1];
    expect(infos.every((info) => !info.flat && info.light === light)).toBe(true);
    expect(Math.hypot(...light)).toBeCloseTo(1, 9);
    expect(light).not.toEqual([0, 0, 1]);
    expect(log).not.toContain('clearDepth');
  });

  it('clears to the bytes of the background as they are, and puts the clear colour that was there back', async () => {
    const { host, clears, log } = fake();
    await createExporter(host)(options());
    // The colour is made in the working space of three from the bytes: converted from sRGB it would be 0.81 for 233, and the picture would be darker than the screen.
    expect(clears[0]?.colour[0]).toBeCloseTo(233 / 255, 12);
    expect(clears[0]?.colour[1]).toBeCloseTo(236 / 255, 12);
    expect(clears[0]?.colour[2]).toBeCloseTo(240 / 255, 12);
    expect(clears[0]?.alpha).toBe(1);
    expect(clears[1]?.colour[0]).toBeCloseTo(0.1, 12);
    expect(clears[1]?.alpha).toBe(0.25);
    // three writes a clear colour for the target that is bound when it is set, and writes it again on every render: the map's is set with the target bound (as it is,
    // for the target), and the screen's is put back once, after the last render, with it unbound (as the screen's is made). Put back earlier, or with the target bound, the
    // screen is cleared to a darker colour from then on (found by the byte-for-byte test of the browser).
    expect(clears.map((clear) => clear.bound)).toEqual([true, false]);
    const last = log.lastIndexOf('clearColour unbound');
    expect(last).toBe(log.length - 1);
    expect(last).toBeGreaterThan(log.lastIndexOf('render b'));
    expect(clears).toHaveLength(2);
  });

  it('gives the picture from its top row, says how far it is in steps and never goes back, and ends at 1', async () => {
    const { host } = fake();
    const bands: [number, number, number][] = [];
    const progress: number[] = [];
    await createExporter(host)(
      options({
        onBand: (rows, first, count) => {
          bands.push([rows.length, first, count]);
        },
        onProgress: (done) => progress.push(done),
      }),
    );
    expect(bands).toEqual([[4 * 6 * 4, 0, 6]]);
    expect(progress).toEqual([0.05, 0.275, 0.5, 1]);
  });

  it('frees the target, and leaves it unbound, when it is aborted while the programs are made', async () => {
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    const controller = new AbortController();
    const { host, log } = fake({
      gl: {
        ...fake().host.gl,
        compileAsync: (scene) => {
          controller.abort(new DOMException('Stopped', 'AbortError'));
          return Promise.resolve(scene);
        },
      },
    });
    await expect(
      createExporter(host)(options({ signal: controller.signal })),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(log).not.toContain('read 0 6');
  });

  it('stops with `interrupted` when the layers change while it draws, reads nothing and frees the target', async () => {
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    const made = fake();
    made.host.yieldTask = () => {
      made.state.revision += 1;
      return Promise.resolve();
    };
    await expect(createExporter(made.host)(options())).rejects.toMatchObject({
      name: 'ExportError',
      code: 'interrupted',
    });
    expect(made.log.some((line) => line.startsWith('read'))).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('is not stopped by a change of the layers once the picture is drawn: what is read is final', async () => {
    const made = fake();
    const read = made.host.read.bind(made.host);
    made.host.read = (target, y, rows, into) => {
      made.state.revision += 1;
      return read(target, y, rows, into);
    };
    await expect(createExporter(made.host)(options())).resolves.toEqual({ viewMode: '2d' });
  });

  it('says the card took the map away when that happens while the picture is read, and frees the target', async () => {
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    const made = fake();
    made.host.read = () => {
      made.state.status = 'lost';
      return Promise.resolve();
    };
    await expect(createExporter(made.host)(options())).rejects.toMatchObject({
      code: 'context_lost',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('says so when the map was taken out of the page, before it touches the card', async () => {
    const made = fake();
    made.state.status = 'disposed';
    await expect(createExporter(made.host)(options())).rejects.toMatchObject({ code: 'disposed' });
    expect(made.log).toEqual([]);
  });

  it('makes one picture at a time: a second is refused while the first is going, and one is made again when it is done', async () => {
    let release: () => void = () => undefined;
    const made = fake();
    made.host.settle = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const exporter = createExporter(made.host);
    const first = exporter(options());
    await expect(exporter(options())).rejects.toMatchObject({ code: 'busy' });
    release();
    await expect(first).resolves.toEqual({ viewMode: '2d' });
    made.host.settle = () => Promise.resolve();
    await expect(exporter(options())).resolves.toEqual({ viewMode: '2d' });
  });

  it('says the card has not the memory when it says so after the drawing, and reads nothing', async () => {
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    let errors = [GL_OUT_OF_MEMORY];
    const made = fake({ error: () => errors.shift() ?? 0 });
    await expect(createExporter(made.host)(options())).rejects.toMatchObject({
      code: 'out_of_memory',
    });
    expect(errors).toEqual([]);
    expect(made.log.some((line) => line.startsWith('read'))).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
    // Other errors of the card are not the memory, and the picture goes on.
    errors = [0x0500, 0];
    await expect(createExporter(made.host)(options())).resolves.toBeDefined();
  });

  it('refuses a picture larger than the card draws, and a point larger than it draws, before it touches anything', async () => {
    const wide = fake();
    await expect(createExporter(wide.host)(options({ width: 8193 }))).rejects.toMatchObject({
      code: 'too_large',
    });
    const high = fake({
      limits: () => ({ renderbuffer: 8192, texture: 4096, viewport: 8192, pointSize: 64 }),
    });
    await expect(createExporter(high.host)(options({ height: 4097 }))).rejects.toMatchObject({
      code: 'too_large',
    });
    // A point of 24 pixels at 300 dpi (3.125) is 75 pixels and the card draws 64: the disc would be cropped to a square.
    const big = fake({ largestPoint: () => 24 });
    await expect(createExporter(big.host)(options({ scale: 3.125 }))).rejects.toMatchObject({
      code: 'point_size',
    });
    for (const made of [wide, high, big]) {
      expect(made.log).toEqual([]);
    }
    // At 96 dpi the same point is 25 pixels: drawn.
    await expect(createExporter(big.host)(options({ scale: 1 }))).resolves.toBeDefined();
  });

  it('says the view changed when it is not the one the cameras were made for', async () => {
    const made = fake({}, ['a'], '3d');
    await expect(createExporter(made.host)(options({ viewMode: '2d' }))).rejects.toMatchObject({
      code: 'interrupted',
    });
  });

  it('is a mistake of the caller, and not an export that failed, to ask for no picture', async () => {
    const { host } = fake();
    const exporter = createExporter(host);
    await expect(exporter(options({ width: 0 }))).rejects.toThrow(RangeError);
    await expect(exporter(options({ height: 2.5 }))).rejects.toThrow(RangeError);
    await expect(exporter(options({ scale: 0 }))).rejects.toThrow(RangeError);
    await expect(exporter(options({ scale: Number.NaN }))).rejects.toThrow(RangeError);
  });

  it('has ExportError for what is not a mistake, with the code', () => {
    const error = new ExportError('busy', 'No.');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('busy');
    expect(error.name).toBe('ExportError');
  });
});
