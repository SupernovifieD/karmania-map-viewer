import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViewer } from './create-viewer.js';

/** A page whose `createElement` hands out fake viewer elements, and the containers that take them. */
function page() {
  const made: { openImport: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = [];
  const tags: string[] = [];
  const createElement = vi.fn((tag: string) => {
    tags.push(tag);
    const element = { openImport: vi.fn(), remove: vi.fn() };
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
  return { made, tags, container };
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
