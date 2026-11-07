import { isPanelTab } from './panel-tabs.js';
import type { PanelTab } from './panel-tabs.js';

/**
 * How wide the panel can be, in pixels. It starts at `default` (the token `--k-panel-width-default`
 * says the same, for the stylesheets), is never narrower than `min`, and never wider than `max` or
 * `maxShare` of the window, whichever is less.
 */
export const PANEL_WIDTH = { default: 360, min: 280, max: 640, maxShare: 0.5 } as const;

/** What of the side panel is kept from one visit to the next. */
export interface PanelState {
  /** Whether the panel is folded away into its rail of buttons. */
  readonly collapsed: boolean;
  /** The tab that is chosen. */
  readonly tab: PanelTab;
  /** How wide the panel is when it is open, as it was asked for: a narrow window may allow less. */
  readonly width: number;
}

/** The panel as it is the first time: open, on the Legend, at its usual width. */
export const DEFAULT_PANEL_STATE: PanelState = {
  collapsed: false,
  tab: 'legend',
  width: PANEL_WIDTH.default,
};

/** The least and the most the panel can be wide in a window `viewportWidth` pixels wide. */
export function panelWidthLimits(viewportWidth: number): { min: number; max: number } {
  const { min, max, maxShare } = PANEL_WIDTH;
  // The least wins if the window is so narrow that half of it is less.
  return { min, max: Math.max(min, Math.min(viewportWidth * maxShare, max)) };
}

/**
 * The width the panel gets for the width it was asked for, in whole pixels, between the limits of
 * the window. A width that is not a number is the usual width.
 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const { min, max } = panelWidthLimits(viewportWidth);
  const asked = Number.isNaN(width) ? PANEL_WIDTH.default : width;
  return Math.round(Math.min(max, Math.max(min, asked)));
}

/** The key the state is kept under. */
export const PANEL_STORAGE_KEY = 'karmania.panel';

/** The part of `Storage` that is used, so that a test can give another. */
export type PanelStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The browser's local storage, or nothing if it will not give it: reaching for `localStorage`
 * itself can throw (a browser that blocks site data does).
 */
export function browserStorage(): PanelStorage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The state that was kept, as text, read as carefully as text from outside should be: anything
 * that is not a state, or is part of one, gives the default for what is missing or wrong.
 */
export function readPanelState(text: string | null): PanelState {
  if (text === null) {
    return DEFAULT_PANEL_STATE;
  }
  let found: unknown;
  try {
    found = JSON.parse(text);
  } catch {
    return DEFAULT_PANEL_STATE;
  }
  if (typeof found !== 'object' || found === null || Array.isArray(found)) {
    return DEFAULT_PANEL_STATE;
  }
  const record = found as Record<string, unknown>;
  const { collapsed, tab, width } = record;
  return {
    collapsed: typeof collapsed === 'boolean' ? collapsed : DEFAULT_PANEL_STATE.collapsed,
    tab: isPanelTab(tab) ? tab : DEFAULT_PANEL_STATE.tab,
    width: typeof width === 'number' && Number.isFinite(width) ? width : DEFAULT_PANEL_STATE.width,
  };
}

/** The state that was kept in `storage`, or the default if there is none, or it cannot be read. */
export function loadPanelState(storage: PanelStorage | undefined): PanelState {
  try {
    return readPanelState(storage?.getItem(PANEL_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_PANEL_STATE;
  }
}

/** Keeps the state in `storage`. If that is not possible, the state is simply not kept. */
export function savePanelState(storage: PanelStorage | undefined, state: PanelState): void {
  try {
    storage?.setItem(PANEL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is full, or blocked: the panel works as well, it only starts afresh next time.
  }
}
