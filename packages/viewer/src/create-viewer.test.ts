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
