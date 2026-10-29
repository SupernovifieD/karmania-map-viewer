import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_STATE,
  loadPanelState,
  PANEL_STORAGE_KEY,
  readPanelState,
  savePanelState,
} from './panel-state.js';
import type { PanelState, PanelStorage } from './panel-state.js';
import { isPanelTab, PANEL_TABS } from './panel-tabs.js';

/** A storage that remembers in a map. */
function memory(initial?: string): PanelStorage & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  if (initial !== undefined) {
    kept.set(PANEL_STORAGE_KEY, initial);
  }
  return {
    kept,
    getItem: (key) => kept.get(key) ?? null,
    setItem: (key, value) => {
      kept.set(key, value);
    },
  };
}

/** A storage that refuses everything, as a browser that blocks site data does. */
const blocked: PanelStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('the tabs of the panel', () => {
  it('are Legend and Data, in that order', () => {
    expect(PANEL_TABS.map((tab) => tab.id)).toEqual(['legend', 'data']);
    expect(PANEL_TABS.map((tab) => tab.label)).toEqual(['Legend', 'Data']);
  });

  it('are recognised by their id and nothing else', () => {
    expect(isPanelTab('legend')).toBe(true);
    expect(isPanelTab('data')).toBe(true);
    for (const other of ['Legend', 'actions', '', 'toString', 0, null, undefined, {}]) {
      expect(isPanelTab(other)).toBe(false);
    }
  });
});

describe('reading the kept state of the panel', () => {
  it('starts open on the Legend when nothing was kept', () => {
    expect(DEFAULT_PANEL_STATE).toEqual({ collapsed: false, tab: 'legend' });
    expect(readPanelState(null)).toEqual(DEFAULT_PANEL_STATE);
  });

  it('reads a state that was kept', () => {
    expect(readPanelState('{"collapsed":true,"tab":"data"}')).toEqual({
      collapsed: true,
      tab: 'data',
    });
    expect(readPanelState('{"collapsed":false,"tab":"legend"}')).toEqual(DEFAULT_PANEL_STATE);
  });

  it('gives the default for text that is not JSON, or not an object', () => {
    for (const text of [
      '',
      'not json',
      '{',
      '[]',
      '[true, "data"]',
      'null',
      '42',
      '"data"',
      'true',
    ]) {
      expect(readPanelState(text), text).toEqual(DEFAULT_PANEL_STATE);
    }
  });

  it('keeps what is good and replaces, field by field, what is not', () => {
    expect(readPanelState('{"collapsed":true}')).toEqual({ collapsed: true, tab: 'legend' });
    expect(readPanelState('{"tab":"data"}')).toEqual({ collapsed: false, tab: 'data' });
    expect(readPanelState('{"collapsed":"yes","tab":"data"}')).toEqual({
      collapsed: false,
      tab: 'data',
    });
    expect(readPanelState('{"collapsed":1,"tab":"map"}')).toEqual(DEFAULT_PANEL_STATE);
    expect(readPanelState('{"collapsed":true,"tab":null}')).toEqual({
      collapsed: true,
      tab: 'legend',
    });
  });

  it('ignores what it does not know', () => {
    expect(readPanelState('{"collapsed":true,"tab":"data","width":9999,"extra":[1]}')).toEqual({
      collapsed: true,
      tab: 'data',
    });
  });
});

describe('keeping the state of the panel', () => {
  it('writes it under one key, and reads back what it wrote', () => {
    const storage = memory();
    const state: PanelState = { collapsed: true, tab: 'data' };
    savePanelState(storage, state);
    expect([...storage.kept.keys()]).toEqual([PANEL_STORAGE_KEY]);
    expect(JSON.parse(storage.kept.get(PANEL_STORAGE_KEY) ?? '')).toEqual(state);
    expect(loadPanelState(storage)).toEqual(state);
  });

  it('loads the default from a storage that has nothing, or is corrupt', () => {
    expect(loadPanelState(memory())).toEqual(DEFAULT_PANEL_STATE);
    expect(loadPanelState(memory('{{{'))).toEqual(DEFAULT_PANEL_STATE);
  });

  it('works without a storage at all, or with one that refuses everything', () => {
    expect(loadPanelState(undefined)).toEqual(DEFAULT_PANEL_STATE);
    expect(loadPanelState(blocked)).toEqual(DEFAULT_PANEL_STATE);
    expect(() => {
      savePanelState(undefined, DEFAULT_PANEL_STATE);
    }).not.toThrow();
    expect(() => {
      savePanelState(blocked, DEFAULT_PANEL_STATE);
    }).not.toThrow();
  });
});
