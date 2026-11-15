import type { Finding } from '@karmania/engine/types';
import { describe, expect, it } from 'vitest';
import { layerNotice } from './layer-notice.js';

const finding = (severity: Finding['severity'], message: string, hint?: string): Finding => {
  const base = { code: 'classes.test', severity, message, count: 1, examples: [] };
  return hint === undefined ? base : { ...base, hint };
};

describe('layerNotice', () => {
  it('says nothing of a layer that is drawn or being prepared', () => {
    expect(layerNotice({ status: 'drawn' })).toBeUndefined();
    expect(layerNotice({ status: 'preparing', fraction: 0.5 })).toBeUndefined();
  });

  it('says that preparing failed, with what to do and what the program said', () => {
    expect(layerNotice({ status: 'failed', message: 'the worker stopped' })).toStrictEqual({
      message: 'Not drawn: preparing this dataset for the map failed.',
      hint: 'Load the file again. If it fails again, that is a fault of the program and not of the data. The program said: “the worker stopped”.',
    });
  });

  it('says that a kind of data is not drawn', () => {
    expect(layerNotice({ status: 'unsupported' })).toStrictEqual({
      message: 'Not drawn: the map does not draw this kind of data yet.',
    });
  });

  it('gives the words of the findings that refused the classes, with `Not drawn:` before them, once', () => {
    expect(
      layerNotice({
        status: 'not_drawn',
        findings: [
          finding('warning', 'w'),
          finding('error', 'The column Rock is text.', 'Colour by categories.'),
        ],
      }),
    ).toStrictEqual({
      message: 'Not drawn: The column Rock is text.',
      hint: 'Colour by categories.',
    });
    expect(
      layerNotice({
        status: 'not_drawn',
        findings: [finding('error', 'Not drawn: in another system.')],
      }),
    ).toStrictEqual({ message: 'Not drawn: in another system.' });
  });

  it('has a reason for findings that say none, so that a layer that is not drawn is never without one', () => {
    expect(layerNotice({ status: 'not_drawn', findings: [] })?.message).toBe(
      'Not drawn: This dataset cannot be drawn in the coordinate system of the map.',
    );
  });
});
