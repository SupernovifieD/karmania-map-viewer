import { Scene, WebGLRenderTarget } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GL_OUT_OF_MEMORY,
  ExportError,
  MAX_SETTLE_TURNS,
  createExporter,
  limitsOf,
  settleUntilReady,
} from './export-render.js';
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
    setClearColor(next, alpha = 1) {
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
    settle: (signal) => {
      notBound('settled');
      signal?.throwIfAborted();
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
    // What the screen is told when the export has drawn: with no target bound, or the colour it would be written for would be the target's.
    restoreScreen: () => {
      notBound('the screen was restored');
      log.push('screen');
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

/** What has to be true of the card and the screen after an export that did not come to an end: nothing is left bound, and the screen was told to set its colour again, last. */
function expectLeftClean(made: Fake): void {
  expect(made.log.filter((line) => line === 'bind')).toHaveLength(
    made.log.filter((line) => line === 'unbind').length,
  );
  expect(made.log.at(-1)).toBe('screen');
}

describe('the export of the map', () => {
  it('makes the programs with the target bound, then clears and draws each layer in a slice of its own that is told what is true first, never waiting while the target is bound', async () => {
    const { host, log } = fake();
    await createExporter(host)(options());
    expect(log).toEqual([
      'settle',
      // The programs: told first, each made with the target bound; the screen is told it has to set its colour again once the target is unbound.
      'prepare',
      'bind',
      'compile a',
      'unbind',
      'bind',
      'compile b',
      'unbind',
      'screen',
      // A turn of the page, in which it looks whether the programs are made and whether it has to stop (see untilMade); they are made already here.
      'yield',
      // The clear is a slice; and then each layer, with the depth cleared before it in 2D. After each slice the screen is told.
      'prepare',
      'bind',
      'clearColour bound',
      'clear',
      'unbind',
      'screen',
      'prepare',
      'bind',
      'place a',
      'clearDepth',
      'render a',
      'unbind',
      'screen',
      'yield',
      'prepare',
      'bind',
      'place b',
      'clearDepth',
      'render b',
      'unbind',
      'screen',
      'yield',
      'read 0 6',
      // And at the very end, once more.
      'screen',
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

  it('clears to the bytes of the background as they are, with the target bound, and tells the screen to set its own colour again after every slice and at the end, never putting back a saved one', async () => {
    const { host, clears, log } = fake();
    await createExporter(host)(options());
    // The colour is made in the working space of three from the bytes: converted from sRGB it would be 0.81 for 233, and the picture would be darker than the screen.
    expect(clears).toHaveLength(1);
    expect(clears[0]?.colour[0]).toBeCloseTo(233 / 255, 12);
    expect(clears[0]?.colour[1]).toBeCloseTo(236 / 255, 12);
    expect(clears[0]?.colour[2]).toBeCloseTo(240 / 255, 12);
    expect(clears[0]?.alpha).toBe(1);
    // three writes a clear colour for the target that is bound when it is set, and writes it again on every render, so the export's colour is in the card when it is done. The
    // screen is told (with no target bound: the fake refuses otherwise) after every slice and at the end, and sets its own from the page when it next draws. It is not put back from a
    // colour saved at the start: a theme that changed meanwhile would be put back to the old one for good (found by a reviewer; the browser test changes the theme meanwhile).
    expect(log.at(-1)).toBe('screen');
    // Two layers: the programs (two unbinds, one telling), the clear and the two layers (three slices, three tellings), and the end: five.
    expect(log.filter((line) => line === 'unbind')).toHaveLength(5);
    expect(log.filter((line) => line === 'screen')).toHaveLength(5);
    expect(log.lastIndexOf('screen')).toBeGreaterThan(log.lastIndexOf('render b'));
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

  it('frees the target, leaves it unbound and tells the screen, when it is aborted while the programs are made', async () => {
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    const controller = new AbortController();
    const made = fake();
    const compile = made.host.gl.compileAsync.bind(made.host.gl);
    made.host.gl.compileAsync = (scene, camera) => {
      controller.abort(new DOMException('Stopped', 'AbortError'));
      return compile(scene, camera);
    };
    await expect(
      createExporter(made.host)(options({ signal: controller.signal })),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(made.log).not.toContain('read 0 6');
    expectLeftClean(made);
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
    expectLeftClean(made);
  });

  it('stops with `interrupted` when the layers change while it waits for them to be built: what it draws is what the caller saw when it asked', async () => {
    const made = fake();
    made.host.settle = () => {
      made.state.revision += 1;
      return Promise.resolve();
    };
    await expect(createExporter(made.host)(options())).rejects.toMatchObject({
      code: 'interrupted',
    });
    expect(made.log).toEqual([]);
  });

  it('stops at once, with the signal’s reason, when it is aborted while it waits for the layers to be built: the wait is given the signal', async () => {
    const controller = new AbortController();
    const made = fake();
    made.host.settle = (signal) =>
      new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        });
        controller.abort(new DOMException('Stopped', 'AbortError'));
      });
    await expect(
      createExporter(made.host)(options({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(made.log).toEqual([]);
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
    expectLeftClean(made);
  });

  it('says the card took the map away when that happens while the programs are made, and does not wait for a program that the card will never finish', async () => {
    const dispose = vi.spyOn(WebGLRenderTarget.prototype, 'dispose');
    const made = fake();
    // Three waits for a program by asking the card whether it is ready; a card that has lost its context says no for ever, and that wait never ends.
    made.host.gl.compileAsync = () => new Promise<never>(() => undefined);
    const yieldTask = made.host.yieldTask.bind(made.host);
    let turns = 0;
    made.host.yieldTask = () => {
      turns += 1;
      if (turns === 3) {
        made.state.status = 'lost';
      }
      return yieldTask();
    };
    await expect(createExporter(made.host)(options())).rejects.toMatchObject({
      code: 'context_lost',
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expectLeftClean(made);
    // And the exporter is free again: the next picture is not refused as busy.
    made.state.status = 'ok';
    made.host.gl.compileAsync = (scene) => Promise.resolve(scene);
    await expect(createExporter(made.host)(options())).resolves.toBeDefined();
  });

  it('stops with the signal’s reason, at once, when it is aborted while the programs are made', async () => {
    const controller = new AbortController();
    const made = fake();
    made.host.gl.compileAsync = () => new Promise<never>(() => undefined);
    const yieldTask = made.host.yieldTask.bind(made.host);
    let turns = 0;
    made.host.yieldTask = () => {
      turns += 1;
      if (turns === 2) {
        controller.abort(new DOMException('Stopped', 'AbortError'));
      }
      return yieldTask();
    };
    await expect(
      createExporter(made.host)(options({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(made.log.some((line) => line.startsWith('render'))).toBe(false);
  });

  it('draws once the programs are made, however many turns they take, and not before', async () => {
    const made = fake();
    // A turn of the page that is a task of its own, as the renderer's is (a turn that is only a promise would leave the timer below no chance).
    made.host.yieldTask = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    let programsMade = false;
    made.host.gl.compileAsync = (scene) =>
      new Promise((resolve) => {
        setTimeout(() => {
          programsMade = true;
          resolve(scene);
        }, 30);
      });
    const render = made.host.gl.render.bind(made.host.gl);
    made.host.gl.render = (scene, camera) => {
      expect(programsMade, 'drawn before the programs were made').toBe(true);
      render(scene, camera);
    };
    await expect(createExporter(made.host)(options())).resolves.toBeDefined();
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
    expectLeftClean(made);
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

describe('settleUntilReady', () => {
  /** A host that is ready after `turns` steps, and counts what is done to it. */
  function waiting(turns: number) {
    const done = { steps: 0, tasks: 0 };
    return {
      done,
      host: {
        unusable: () => false,
        ready: () => done.steps >= turns,
        step: () => {
          done.steps += 1;
        },
        nextTask: () => {
          done.tasks += 1;
          return Promise.resolve();
        },
      },
    };
  }

  it('returns at once when the layers are built, with no step and no turn of the page', async () => {
    const { host, done } = waiting(0);
    await settleUntilReady(host);
    expect(done).toEqual({ steps: 0, tasks: 0 });
  });

  it('does a step and gives the page a turn until the layers are built', async () => {
    const { host, done } = waiting(4);
    await settleUntilReady(host);
    expect(done).toEqual({ steps: 4, tasks: 4 });
  });

  it('stops with the signal’s reason as soon as it is aborted, between two turns, and does no more steps', async () => {
    const controller = new AbortController();
    const { host, done } = waiting(1000);
    const next = host.nextTask;
    host.nextTask = () => {
      if (done.tasks === 2) {
        controller.abort(new DOMException('Stopped', 'AbortError'));
      }
      return next();
    };
    await expect(settleUntilReady(host, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(done.steps).toBe(3);
  });

  it('is not started for a signal that is aborted already', async () => {
    const { host, done } = waiting(3);
    await expect(settleUntilReady(host, AbortSignal.abort())).rejects.toBeDefined();
    expect(done.steps).toBe(0);
  });

  it('returns when the renderer cannot be drawn on, so that the export says why', async () => {
    const { host, done } = waiting(1000);
    host.unusable = () => true;
    await settleUntilReady(host);
    expect(done.steps).toBe(0);
  });

  it('says it is not ready, by ExportError, after the turns it is given, and never waits by the clock', async () => {
    const { host, done } = waiting(Number.POSITIVE_INFINITY);
    await expect(settleUntilReady(host, undefined, 7)).rejects.toMatchObject({
      name: 'ExportError',
      code: 'not_ready',
    });
    expect(done.steps).toBe(7);
    expect(MAX_SETTLE_TURNS).toBe(3000);
  });
});

describe('limitsOf', () => {
  const card = {
    renderbuffer: 16_384,
    texture: 8192,
    viewport: Int32Array.of(16_384, 16_384),
    pointRange: Float32Array.of(1, 255),
  };

  it('is what the card says: the renderbuffer and texture, the point range’s largest, and the viewport', () => {
    expect(limitsOf(card, 4096)).toEqual({
      renderbuffer: 16_384,
      texture: 8192,
      viewport: 16_384,
      pointSize: 255,
    });
  });

  it('takes the least of the two numbers of the viewport: a card may allow a different width and height', () => {
    expect(limitsOf({ ...card, viewport: Int32Array.of(16_384, 4096) }, 4096).viewport).toBe(4096);
    expect(limitsOf({ ...card, viewport: Int32Array.of(2048, 16_384) }, 4096).viewport).toBe(2048);
  });

  it('is the fallback for what is missing or is not a number above 0, and 1 for a point range that is missing', () => {
    expect(
      limitsOf(
        { renderbuffer: undefined, texture: 'big', viewport: null, pointRange: undefined },
        4096,
      ),
    ).toEqual({ renderbuffer: 4096, texture: 4096, viewport: 4096, pointSize: 1 });
    expect(limitsOf({ ...card, renderbuffer: 0, texture: Number.NaN }, 100)).toMatchObject({
      renderbuffer: 100,
      texture: 100,
    });
    expect(limitsOf({ ...card, viewport: Int32Array.of(0, 5000) }, 100).viewport).toBe(100);
  });
});
