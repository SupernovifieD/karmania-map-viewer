import { describe, expect, it } from 'vitest';
import { northArrow } from './north-arrow.js';

describe('the north arrow', () => {
  it('points straight up when the map has north at the top', () => {
    expect(northArrow(0)).toEqual({ angle: 0, degrees: 0, northUp: true, label: 'North is up' });
  });

  it('turns the needle the opposite way to the map: facing east puts north on the left', () => {
    expect(northArrow(90).angle).toBe(-90);
    expect(northArrow(30).angle).toBe(-30);
    expect(northArrow(270).angle).toBe(90);
    expect(northArrow(330).angle).toBe(30);
  });

  it('keeps the needle between -180 and 180 degrees, and south as 180', () => {
    expect(northArrow(180).angle).toBe(180);
    expect(northArrow(181).angle).toBe(179);
    expect(northArrow(179).angle).toBe(-179);
    for (const heading of [-720.5, -360, -45, 0, 45, 360, 725, 1e6]) {
      const { angle } = northArrow(heading);
      expect(angle).toBeGreaterThan(-180 - 1e-9);
      expect(angle).toBeLessThanOrEqual(180);
    }
  });

  it('takes a heading outside 0 to 360 as the direction it is the same as', () => {
    expect(northArrow(-30)).toMatchObject({ angle: 30, degrees: 330 });
    expect(northArrow(390)).toMatchObject({ angle: -30, degrees: 30 });
    expect(northArrow(720)).toMatchObject({ angle: 0, northUp: true });
  });

  it('says the whole degrees the map is turned, and that north is up to the whole degree', () => {
    expect(northArrow(30).label).toBe('Map turned 30° from north');
    expect(northArrow(30.4).degrees).toBe(30);
    expect(northArrow(30.6).degrees).toBe(31);
    expect(northArrow(0.4)).toMatchObject({ northUp: true, label: 'North is up', degrees: 0 });
    expect(northArrow(359.6)).toMatchObject({ northUp: true, degrees: 0, label: 'North is up' });
    expect(northArrow(359.4)).toMatchObject({ northUp: false, degrees: 359 });
    expect(northArrow(0.6)).toMatchObject({ northUp: false, degrees: 1 });
  });

  it('points up when the heading is not a number, as nothing is known to turn it', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(northArrow(bad)).toEqual({
        angle: 0,
        degrees: 0,
        northUp: true,
        label: 'North is up',
      });
    }
  });
});
