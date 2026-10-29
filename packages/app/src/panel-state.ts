import { isPanelTab } from './panel-tabs.js';
import type { PanelTab } from './panel-tabs.js';

/** What of the side panel is kept from one visit to the next. */
export interface PanelState {
  /** Whether the panel is folded away into its rail of buttons. */
  readonly collapsed: boolean;
  /** The tab that is chosen. */
  readonly tab: PanelTab;
}

/** The panel as it is the first time: open, on the Legend. */
export const DEFAULT_PANEL_STATE: PanelState = { collapsed: false, tab: 'legend' };

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
  const { collapsed, tab } = record;
  return {
    collapsed: typeof collapsed === 'boolean' ? collapsed : DEFAULT_PANEL_STATE.collapsed,
    tab: isPanelTab(tab) ? tab : DEFAULT_PANEL_STATE.tab,
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
