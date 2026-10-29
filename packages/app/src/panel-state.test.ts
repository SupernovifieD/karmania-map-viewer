import { describe, expect, it } from 'vitest';
import {
  clampPanelWidth,
  DEFAULT_PANEL_STATE,
  loadPanelState,
  PANEL_STORAGE_KEY,
  PANEL_WIDTH,
  panelWidthLimits,
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
  it('starts open on the Legend, 360 wide, when nothing was kept', () => {
    expect(DEFAULT_PANEL_STATE).toEqual({ collapsed: false, tab: 'legend', width: 360 });
    expect(readPanelState(null)).toEqual(DEFAULT_PANEL_STATE);
  });

  it('reads a state that was kept', () => {
    expect(readPanelState('{"collapsed":true,"tab":"data","width":420}')).toEqual({
      collapsed: true,
      tab: 'data',
      width: 420,
    });
    expect(readPanelState('{"collapsed":false,"tab":"legend","width":360}')).toEqual(
      DEFAULT_PANEL_STATE,
    );
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
    expect(readPanelState('{"collapsed":true}')).toEqual({
      ...DEFAULT_PANEL_STATE,
      collapsed: true,
    });
    expect(readPanelState('{"tab":"data"}')).toEqual({ ...DEFAULT_PANEL_STATE, tab: 'data' });
    expect(readPanelState('{"width":500}')).toEqual({ ...DEFAULT_PANEL_STATE, width: 500 });
    expect(readPanelState('{"collapsed":"yes","tab":"data"}')).toEqual({
      ...DEFAULT_PANEL_STATE,
      tab: 'data',
    });
    expect(readPanelState('{"collapsed":1,"tab":"map","width":"wide"}')).toEqual(
      DEFAULT_PANEL_STATE,
    );
    expect(readPanelState('{"collapsed":true,"tab":null}')).toEqual({
      ...DEFAULT_PANEL_STATE,
      collapsed: true,
    });
  });

  it('takes a width that is a number and leaves its size to whoever uses it', () => {
    // Too narrow or too wide for any window is still a number: it is limited when it is used.
    expect(readPanelState('{"width":-5}').width).toBe(-5);
    expect(readPanelState('{"width":99999}').width).toBe(99999);
    expect(readPanelState('{"width":412.6}').width).toBe(412.6);
    // But not one that is not a number: null (what JSON makes of Infinity), a word, a list.
    for (const text of ['null', '"360"', '[360]', 'true', '{}']) {
      expect(readPanelState(`{"width":${text}}`).width, text).toBe(360);
    }
  });

  it('ignores what it does not know', () => {
    expect(readPanelState('{"collapsed":true,"tab":"data","width":500,"extra":[1]}')).toEqual({
      collapsed: true,
      tab: 'data',
      width: 500,
    });
  });
});

describe('the width of the panel', () => {
  it('is 360 to start with, between 280 and 640, and at most half the window', () => {
    expect(PANEL_WIDTH).toEqual({ default: 360, min: 280, max: 640, maxShare: 0.5 });
  });

  it('is limited by the window: half of it, up to 640, and never under 280', () => {
    expect(panelWidthLimits(1024)).toEqual({ min: 280, max: 512 });
    expect(panelWidthLimits(1440)).toEqual({ min: 280, max: 640 });
    expect(panelWidthLimits(1920)).toEqual({ min: 280, max: 640 });
    expect(panelWidthLimits(2560)).toEqual({ min: 280, max: 640 });
    expect(panelWidthLimits(1280)).toEqual({ min: 280, max: 640 });
    expect(panelWidthLimits(1100)).toEqual({ min: 280, max: 550 });
    // So small a window that half of it is under the least: the least stands.
    expect(panelWidthLimits(400)).toEqual({ min: 280, max: 280 });
    expect(panelWidthLimits(0)).toEqual({ min: 280, max: 280 });
  });

  it('is kept between the limits, in whole pixels', () => {
    expect(clampPanelWidth(360, 1440)).toBe(360);
    expect(clampPanelWidth(100, 1440)).toBe(280);
    expect(clampPanelWidth(700, 1440)).toBe(640);
    expect(clampPanelWidth(700, 1024)).toBe(512);
    expect(clampPanelWidth(280, 1024)).toBe(280);
    expect(clampPanelWidth(512, 1024)).toBe(512);
    expect(clampPanelWidth(300.4, 1440)).toBe(300);
    expect(clampPanelWidth(300.5, 1440)).toBe(301);
    expect(clampPanelWidth(500, 400)).toBe(280);
  });

  it('is still a width for numbers that are not widths', () => {
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, 1440)).toBe(640);
    expect(clampPanelWidth(Number.NEGATIVE_INFINITY, 1440)).toBe(280);
    expect(clampPanelWidth(-1, 1440)).toBe(280);
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(360);
    expect(clampPanelWidth(Number.NaN, 1024)).toBe(360);
  });
});

describe('keeping the state of the panel', () => {
  it('writes it under one key, and reads back what it wrote', () => {
    const storage = memory();
    const state: PanelState = { collapsed: true, tab: 'data', width: 444 };
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
