import type { Page } from '@playwright/test';

/** One element's place in a snapshot: where it is, how big it is, how big its content is, how far it is scrolled. */
export type Placement = readonly [
  path: string,
  x: number,
  y: number,
  width: number,
  height: number,
  scrollWidth: number,
  scrollHeight: number,
  scrollLeft: number,
  scrollTop: number,
];

/**
 * The place of every element of the app, through its shadow roots, leaving out the elements that
 * match `ignoring` and what is inside them. Two snapshots that are not equal mean that something
 * moved or changed size between them, which is what "no layout shift" says does not happen: take
 * one before a hover, a focus or a drag and one during it, and compare. What is ignored is what
 * is meant to appear (a tooltip, a drop zone), laid over the page without being part of it.
 */
export function layoutOf(page: Page, ignoring: string): Promise<Placement[]> {
  return page.evaluate((ignored) => {
    const found: Placement[] = [];
    const visit = (node: Element, path: string): void => {
      if (node.matches(ignored)) {
        return;
      }
      const box = node.getBoundingClientRect();
      found.push([
        path,
        box.x,
        box.y,
        box.width,
        box.height,
        node.scrollWidth,
        node.scrollHeight,
        node.scrollLeft,
        node.scrollTop,
      ]);
      [...(node.shadowRoot?.children ?? []), ...node.children].forEach((child, index) => {
        visit(child, `${path}>${child.tagName.toLowerCase()}[${String(index)}]`);
      });
    };
    const app = document.querySelector('karmania-app');
    if (app !== null) {
      visit(app, 'app');
    }
    return found;
  }, ignoring);
}
