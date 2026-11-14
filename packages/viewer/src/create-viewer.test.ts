import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewer } from './create-viewer.js';

/** A page whose `createElement` hands out fake viewer elements, and the containers that take them. */
function page() {
  const scene = { version: 1 };
  const made: {
    openImport: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    scene: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn>;
    fit: ReturnType<typeof vi.fn>;
    setViewMode: ReturnType<typeof vi.fn>;
    subscribeToScene: ReturnType<typeof vi.fn>;
    heard: ((scene: unknown, previous: unknown) => void)[];
    stopped: ReturnType<typeof vi.fn>;
  }[] = [];
  const tags: string[] = [];
  const createElement = vi.fn((tag: string) => {
    tags.push(tag);
    const element = {
      openImport: vi.fn(),
      remove: vi.fn(),
      scene: vi.fn(() => scene),
      dispatch: vi.fn((command: unknown) => ({ command })),
      fit: vi.fn(),
      setViewMode: vi.fn(),
      heard: [] as ((scene: unknown, previous: unknown) => void)[],
      stopped: vi.fn(),
      subscribeToScene: vi.fn((listener: (scene: unknown, previous: unknown) => void) => {
        element.heard.push(listener);
        return element.stopped;
      }),
    };
    made.push(element);
    return element;
  });
  vi.stubGlobal('document', { createElement });
  const container = () => {
    const children: unknown[] = [];
    return {
      children,
      element: { append: (child: unknown) => children.push(child) } as unknown as HTMLElement,
    };
  };
  return { made, tags, scene, container };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createViewer', () => {
  it('puts one viewer element in the container', () => {
    const { made, tags, container } = page();
    const where = container();
    createViewer(where.element);
    expect(tags).toEqual(['karmania-viewer']);
    expect(where.children).toEqual([made[0]]);
  });

  it('opens the import wizard on the files it is given, or the file picker with none', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    const files = [new Uint8Array(0)] as unknown as File[];
    viewer.openImport(files);
    viewer.openImport();
    expect(made[0]?.openImport.mock.calls).toEqual([[files], [undefined]]);
  });

  it('gives the scene the viewer holds, and refuses to once it was disposed', () => {
    const { made, scene, container } = page();
    const viewer = createViewer(container().element);
    expect(viewer.scene()).toBe(scene);
    viewer.dispose();
    expect(() => viewer.scene()).toThrow('The viewer has been disposed.');
    expect(made[0]?.scene).toHaveBeenCalledTimes(1);
  });

  it('asks the viewer to fit the data, and refuses once it was disposed', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    viewer.fit();
    expect(made[0]?.fit).toHaveBeenCalledTimes(1);
    viewer.dispose();
    expect(() => {
      viewer.fit();
    }).toThrow('The viewer has been disposed.');
    expect(made[0]?.fit).toHaveBeenCalledTimes(1);
  });

  it('hands a command to the scene and gives back what comes of it, and refuses once it was disposed', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    const command = { type: 'setViewMode', mode: '2d' } as const;
    expect(viewer.dispatch(command)).toEqual({ command });
    expect(made[0]?.dispatch).toHaveBeenCalledExactlyOnceWith(command);
    viewer.dispose();
    expect(() => viewer.dispatch(command)).toThrow('The viewer has been disposed.');
    expect(made[0]?.dispatch).toHaveBeenCalledTimes(1);
  });

  it('asks the viewer to show the map in the view it is given, and refuses once it was disposed', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    viewer.setViewMode('3d');
    viewer.setViewMode('2d');
    expect(made[0]?.setViewMode.mock.calls).toEqual([['3d'], ['2d']]);
    viewer.dispose();
    expect(() => {
      viewer.setViewMode('3d');
    }).toThrow('The viewer has been disposed.');
    expect(made[0]?.setViewMode).toHaveBeenCalledTimes(2);
  });

  it('tells a listener of the scene each time it changes, with the document and nothing else (not the one before), and stops when asked', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    const listener = vi.fn();
    const stop = viewer.on('scene', listener);
    expect(made[0]?.subscribeToScene).toHaveBeenCalledTimes(1);
    made[0]?.heard[0]?.({ version: 1 }, { version: 0 });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ version: 1 });
    // Each change is told, with the document it made and not the one before it.
    made[0]?.heard[0]?.({ version: 2 }, { version: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({ version: 2 });
    stop();
    expect(made[0]?.stopped).toHaveBeenCalledTimes(1);
    // Stopping again does nothing more.
    stop();
    expect(made[0]?.stopped).toHaveBeenCalledTimes(1);
  });

  it('stops every listener when it is disposed, and only the ones that were not stopped already', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    const first = viewer.on('scene', () => undefined);
    viewer.on('scene', () => undefined);
    viewer.on('scene', () => undefined);
    first();
    expect(made[0]?.stopped).toHaveBeenCalledTimes(1);
    viewer.dispose();
    expect(made[0]?.stopped).toHaveBeenCalledTimes(3);
    // The way to stop one that was stopped by the disposal does nothing more.
    first();
    expect(made[0]?.stopped).toHaveBeenCalledTimes(3);
  });

  it('refuses to listen to a viewer that was disposed', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    viewer.dispose();
    expect(() => viewer.on('scene', () => undefined)).toThrow('The viewer has been disposed.');
    expect(made[0]?.subscribeToScene).not.toHaveBeenCalled();
  });

  it('takes the element out of the page when it is disposed, once, however often it is asked', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    viewer.dispose();
    viewer.dispose();
    expect(made[0]?.remove).toHaveBeenCalledTimes(1);
  });

  it('refuses to open the wizard after it was disposed, and does not touch the element', () => {
    const { made, container } = page();
    const viewer = createViewer(container().element);
    viewer.dispose();
    expect(() => {
      viewer.openImport();
    }).toThrow('The viewer has been disposed.');
    expect(made[0]?.openImport).not.toHaveBeenCalled();
  });

  it('keeps two viewers apart: disposing one leaves the other', () => {
    const { made, container } = page();
    const first = createViewer(container().element);
    const second = createViewer(container().element);
    expect(made).toHaveLength(2);
    first.dispose();
    second.openImport();
    expect(made[0]?.remove).toHaveBeenCalledTimes(1);
    expect(made[1]?.remove).not.toHaveBeenCalled();
    expect(made[1]?.openImport).toHaveBeenCalledTimes(1);
    expect(() => {
      first.openImport();
    }).toThrow();
  });
});
