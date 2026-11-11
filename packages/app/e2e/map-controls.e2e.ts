import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { camera, camera3d, dispatch, stats, withData } from './support/render.js';
import type { Camera, Camera3d } from './support/render.js';

const canvas = (page: Page) => page.locator('karmania-map-area canvas');

/** Where the map is on the page, in CSS pixels. */
async function boxOf(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await canvas(page).boundingBox();
  if (box === null) {
    throw new Error('The canvas is not shown.');
  }
  return box;
}

/** The point of the map under a point of the page, worked out here from a camera and the box of the map (the arithmetic, said again). */
function mapAt(
  view: Camera,
  box: { x: number; y: number; width: number; height: number },
  pageX: number,
  pageY: number,
): [number, number] {
  const right = (pageX - box.x - box.width / 2) * view.unitsPerPixel;
  const up = (box.y + box.height / 2 - pageY) * view.unitsPerPixel;
  const heading = (view.heading * Math.PI) / 180;
  return [
    view.centre[0] + right * Math.cos(heading) + up * Math.sin(heading),
    view.centre[1] - right * Math.sin(heading) + up * Math.cos(heading),
  ];
}

/** The scale the pipeline fitted the data to, which the limits of the scale are made from. */
let fitScale = 1;

/** A map with a camera that is easy to read: 2 units a pixel, centred on 1000, 2000, heading 0 (or another). */
async function start(
  page: Page,
  heading = 0,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await page.goto('/');
  await withData(page);
  // The pipeline has chosen the frame and fitted the camera by now; that scale is what the limits of the scale are made from.
  fitScale = (await camera(page)).unitsPerPixel;
  await dispatch(page, {
    type: 'setCamera',
    patch: { camera2d: { centre: [1000, 2000], unitsPerPixel: 2, heading } },
  });
  return boxOf(page);
}

/** A 3D map with a camera whose pointer changes are easy to read. */
async function start3d(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await start(page);
  await dispatch(
    page,
    {
      type: 'setCamera',
      patch: {
        camera3d: {
          target: [1000, 2000, 100],
          distance: 1000,
          heading: 30,
          elevation: 40,
          fov: 50,
        },
      },
    },
    { type: 'setViewMode', mode: '3d' },
  );
  await expect.poll(async () => (await stats(page))?.viewMode).toBe('3d');
  return box;
}

/** The point on the camera's target plane under a page point. */
function targetPlaneAt(
  view: Camera3d,
  box: { x: number; y: number; width: number; height: number },
  pageX: number,
  pageY: number,
): [number, number, number] {
  const heading = (view.heading * Math.PI) / 180;
  const elevation = (view.elevation * Math.PI) / 180;
  const halfHeight = view.distance * Math.tan((view.fov * Math.PI) / 360);
  const rightOffset =
    ((2 * (pageX - box.x)) / box.width - 1) * halfHeight * (box.width / box.height);
  const upOffset = (1 - (2 * (pageY - box.y)) / box.height) * halfHeight;
  const right = [Math.cos(heading), -Math.sin(heading), 0];
  const up = [
    Math.sin(heading) * Math.sin(elevation),
    Math.cos(heading) * Math.sin(elevation),
    Math.cos(elevation),
  ];
  return view.target.map(
    (value, axis) => value + (right[axis] ?? 0) * rightOffset + (up[axis] ?? 0) * upOffset,
  ) as [number, number, number];
}

const near = (actual: number, expected: number, digits = 6): void => {
  expect(actual).toBeCloseTo(expected, digits);
};

test.describe('moving the 2D map with the pointer', () => {
  test('drags it with the left button, the map following the pointer', async ({ page }) => {
    const box = await start(page);
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 100, y + 50, { steps: 5 });
    // Mid-drag the cursor is a closed hand, and the camera is already where the pointer took it.
    expect(await canvas(page).evaluate((element) => getComputedStyle(element).cursor)).toBe(
      'grabbing',
    );
    await page.mouse.up();
    expect(await canvas(page).evaluate((element) => getComputedStyle(element).cursor)).toBe('grab');
    const view = await camera(page);
    expect(view.centre).toEqual([800, 2100]);
    expect(view.unitsPerPixel).toBe(2);
    expect(view.heading).toBe(0);
  });

  test('keeps the point that was under the pointer under it when the map is turned, as it is dragged', async ({
    page,
  }) => {
    const box = await start(page, 90);
    const before = await camera(page);
    const [x, y] = [box.x + 200, box.y + 150];
    const under = mapAt(before, box, x, y);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y - 70, { steps: 4 });
    await page.mouse.move(x + 60, y + 90, { steps: 4 });
    await page.mouse.up();
    const after = mapAt(await camera(page), box, x + 60, y + 90);
    near(after[0], under[0]);
    near(after[1], under[1]);
    expect((await camera(page)).heading).toBe(90);
  });

  test('zooms to the pointer with the wheel: what is under it stays, and up comes closer', async ({
    page,
  }) => {
    const box = await start(page);
    const [x, y] = [box.x + 600, box.y + 100];
    const under = mapAt(await camera(page), box, x, y);
    // The page is asked not to scroll under the wheel (the listener of the page is after the map's, and sees what it did).
    await page.evaluate(() => {
      (window as unknown as { wheels: boolean[] }).wheels = [];
      window.addEventListener('wheel', (event) => {
        (window as unknown as { wheels: boolean[] }).wheels.push(event.defaultPrevented);
      });
    });
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await camera(page)).unitsPerPixel).toBeLessThan(2);
    const closer = await camera(page);
    near(closer.unitsPerPixel, 2 * Math.exp(-300 * 0.0015), 9);
    near(mapAt(closer, box, x, y)[0], under[0]);
    near(mapAt(closer, box, x, y)[1], under[1]);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeGreaterThan(closer.unitsPerPixel);
    const farther = await camera(page);
    near(mapAt(farther, box, x, y)[0], under[0]);
    near(mapAt(farther, box, x, y)[1], under[1]);
    // The wheel moved nothing but the scale and the centre.
    expect(farther.heading).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { wheels: boolean[] }).wheels)).toEqual([
      true,
      true,
    ]);
  });

  test('turns it about the middle with the right button, the map following the pointer, and shows no menu', async ({
    page,
  }) => {
    const box = await start(page);
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.evaluate(() => {
      (window as unknown as { menus: boolean[] }).menus = [];
      window.addEventListener('contextmenu', (event) => {
        (window as unknown as { menus: boolean[] }).menus.push(event.defaultPrevented);
      });
    });
    await page.mouse.move(cx + 150, cy);
    await page.mouse.down({ button: 'right' });
    // A quarter of a turn clockwise: from the right of the middle to below it.
    for (const [dx, dy] of [
      [106, 106],
      [0, 150],
    ] as const) {
      await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
    }
    await page.mouse.up({ button: 'right' });
    const view = await camera(page);
    // The map went clockwise on the screen, so the top of the screen faces 90 degrees anticlockwise: 270.
    near(view.heading, 270, 6);
    near(view.centre[0], 1000);
    near(view.centre[1], 2000);
    expect(view.unitsPerPixel).toBe(2);
    expect(await page.evaluate(() => (window as unknown as { menus: boolean[] }).menus)).toEqual([
      true,
    ]);
  });

  test('does nothing for the middle button, and lets go of a drag that was cancelled', async ({
    page,
  }) => {
    const box = await start(page);
    const [x, y] = [box.x + 300, box.y + 300];
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(x + 80, y + 80, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    expect(await camera(page)).toEqual({ centre: [1000, 2000], unitsPerPixel: 2, heading: 0 });
    // A drag that the browser cancels (a touch that becomes a scroll, a window that loses the pointer) ends there.
    await page.mouse.down();
    await page.mouse.move(x + 20, y, { steps: 2 });
    await canvas(page).evaluate((element) => {
      element.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, composed: true }),
      );
    });
    expect(await canvas(page).evaluate((element) => element.dataset['dragging'])).toBeUndefined();
    const moved = await camera(page);
    await page.mouse.move(x + 200, y + 200, { steps: 3 });
    expect(await camera(page)).toEqual(moved);
    await page.mouse.up();
  });

  test('holds the scale between its limits, and draws nothing once it is at one', async ({
    page,
  }) => {
    const box = await start(page);
    const [x, y] = [box.x + 100, box.y + 100];
    await page.mouse.move(x, y);
    // (The limits are those of the data: a hundred thousand times closer than the fit, and a hundred times farther.)
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, -4000);
    }
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(fitScale / 100_000, 12);
    const frames = (await stats(page))?.frames;
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(300);
    expect((await stats(page))?.frames).toBe(frames);
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, 4000);
    }
    await expect
      .poll(async () => (await camera(page)).unitsPerPixel)
      .toBeCloseTo(fitScale * 100, 6);
  });
});

test.describe('moving the 2D map with the keyboard', () => {
  test('is a stop of the keyboard once there is a map to move, and not before', async ({
    page,
  }) => {
    const main = page.locator('karmania-map-area main');
    await page.goto('/');
    await expect(main).not.toHaveAttribute('tabindex', /.*/);
    await withData(page);
    await expect(main).toHaveAttribute('tabindex', '0');
    // Taken out of the page, it is not one again.
    await page.evaluate(() => {
      const area = document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer')
        ?.shadowRoot?.querySelector('karmania-map-area');
      document
        .querySelector('karmania-app')
        ?.shadowRoot?.querySelector('karmania-viewer')
        ?.remove();
      (window as unknown as { area: unknown }).area = area;
    });
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { area: HTMLElement & { interactive: boolean } }).area.interactive,
      ),
    ).toBe(false);
  });

  /** Puts the keyboard on the map: a press on it without a drag. */
  async function focusMap(
    page: Page,
    box: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() =>
        page.evaluate(() => {
          let active: Element | null = document.activeElement;
          while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement;
          }
          return active?.tagName.toLowerCase();
        }),
      )
      .toBe('main');
  }

  test('pans by 50 pixels with an arrow, the view going the way of the arrow', async ({ page }) => {
    const box = await start(page);
    await focusMap(page, box);
    await page.keyboard.press('ArrowRight');
    expect((await camera(page)).centre).toEqual([1100, 2000]);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await camera(page)).centre).toEqual([900, 2000]);
    await page.keyboard.press('ArrowUp');
    expect((await camera(page)).centre).toEqual([900, 2100]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect((await camera(page)).centre).toEqual([900, 1900]);
  });

  test('pans along the screen when the map is turned', async ({ page }) => {
    const box = await start(page, 90);
    await focusMap(page, box);
    // With the top of the screen facing east, up the screen is east.
    await page.keyboard.press('ArrowUp');
    const view = await camera(page);
    near(view.centre[0], 1100, 9);
    near(view.centre[1], 2000, 9);
  });

  test('zooms with + and -, = being the + of a keyboard where + is shifted, and two presses are twice', async ({
    page,
  }) => {
    const box = await start(page);
    await focusMap(page, box);
    await page.keyboard.press('+');
    near((await camera(page)).unitsPerPixel, 2 / Math.SQRT2, 9);
    await page.keyboard.press('=');
    near((await camera(page)).unitsPerPixel, 1, 9);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await page.keyboard.press('Shift+_');
    near((await camera(page)).unitsPerPixel, 2 * Math.SQRT2, 9);
    // The centre is where it was: the keys zoom about the middle.
    expect((await camera(page)).centre).toEqual([1000, 2000]);
  });

  test('turns by 15 degrees with Shift and the left or right arrow, and 0 puts north up', async ({
    page,
  }) => {
    const box = await start(page);
    await focusMap(page, box);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect((await camera(page)).heading).toBe(30);
    await page.keyboard.press('Shift+ArrowLeft');
    expect((await camera(page)).heading).toBe(15);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    // The scene keeps a heading from 0 to 360.
    expect((await camera(page)).heading).toBe(345);
    await page.keyboard.press('0');
    expect((await camera(page)).heading).toBe(0);
    // About the middle: the centre stayed.
    const view = await camera(page);
    near(view.centre[0], 1000, 9);
    near(view.centre[1], 2000, 9);
  });

  test('leaves keys with Control or Meta, Shift and the up arrow, and other keys, alone', async ({
    page,
  }) => {
    const box = await start(page);
    await focusMap(page, box);
    const before = await camera(page);
    for (const key of [
      'Control+ArrowRight',
      'Meta+ArrowLeft',
      'Alt+ArrowUp',
      'Shift+ArrowUp',
      'Shift+ArrowDown',
      'a',
      'Enter',
      'PageUp',
      'Control+0',
    ]) {
      await page.keyboard.press(key);
    }
    expect(await camera(page)).toEqual(before);
  });

  test('answers to the keys only when the map has the focus: a key with the focus elsewhere moves nothing', async ({
    page,
  }) => {
    await start(page);
    const before = await camera(page);
    // The Import button of the toolbar has the focus.
    await page.locator('karmania-app header.toolbar k-button button').focus();
    for (const key of ['ArrowRight', '+', '0', 'Shift+ArrowRight']) {
      await page.keyboard.press(key);
    }
    expect(await camera(page)).toEqual(before);
  });

  test('takes the keys it handles from the browser and leaves it the rest: the page does not scroll under an arrow', async ({
    page,
  }) => {
    const box = await start(page);
    await focusMap(page, box);
    await page.evaluate(() => {
      const seen: [string, boolean][] = [];
      (window as unknown as { seen: [string, boolean][] }).seen = seen;
      window.addEventListener('keydown', (event) => {
        // Pressing Shift or Control is a key event of its own, and not what is asked about.
        if (!['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) {
          seen.push([event.key, event.defaultPrevented]);
        }
      });
    });
    for (const key of [
      'ArrowRight',
      'Shift+ArrowLeft',
      '+',
      '-',
      '0',
      'a',
      'Control+ArrowRight',
      'Shift+ArrowUp',
      'Enter',
    ]) {
      await page.keyboard.press(key);
    }
    expect(
      await page.evaluate(() => (window as unknown as { seen: [string, boolean][] }).seen),
    ).toEqual([
      ['ArrowRight', true],
      ['ArrowLeft', true],
      ['+', true],
      ['-', true],
      ['0', true],
      ['a', false],
      ['ArrowRight', false],
      ['ArrowUp', false],
      ['Enter', false],
    ]);
  });

  test('is reached with Tab, and shows the ring inside the area, where it is not cut off', async ({
    page,
  }) => {
    await start(page);
    await page.locator('karmania-app header.toolbar k-button button').focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      let active: Element | null = document.activeElement;
      while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      const style = active === null ? undefined : getComputedStyle(active);
      return {
        tag: active?.tagName.toLowerCase(),
        label: active?.getAttribute('aria-label'),
        style: style?.outlineStyle,
        width: style?.outlineWidth,
        offset: style?.outlineOffset,
      };
    });
    expect(ring).toEqual({
      tag: 'main',
      label: 'Map',
      style: 'solid',
      width: '2px',
      offset: '-2px',
    });
  });
});

test.describe('moving the 3D map with the pointer', () => {
  test('orbits with left drag, and pans equally with right drag or Shift-left drag', async ({
    page,
  }) => {
    const box = await start3d(page);
    const original = await camera3d(page);
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 60, { steps: 4 });
    await page.mouse.up();
    const orbit = await camera3d(page);
    near(orbit.heading, (original.heading - (120 * 180) / box.height + 360) % 360);
    near(orbit.elevation, original.elevation - (60 * 180) / box.height);
    expect(orbit.target).toEqual(original.target);
    expect(orbit.distance).toBe(original.distance);

    await dispatch(page, { type: 'setCamera', patch: { camera3d: original } });
    await page.evaluate(() => {
      (window as unknown as { menus: boolean[] }).menus = [];
      window.addEventListener('contextmenu', (event) => {
        (window as unknown as { menus: boolean[] }).menus.push(event.defaultPrevented);
      });
    });
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 80, y - 40, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    const right = await camera3d(page);
    expect(right.target).not.toEqual(original.target);
    expect({ ...right, target: original.target }).toEqual(original);
    expect(await page.evaluate(() => (window as unknown as { menus: boolean[] }).menus)).toEqual([
      true,
    ]);

    await dispatch(page, { type: 'setCamera', patch: { camera3d: original } });
    await page.keyboard.down('Shift');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y - 40, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const shifted = await camera3d(page);
    shifted.target.forEach((value, axis) => {
      near(value, right.target[axis] ?? NaN);
    });
    expect({ ...shifted, target: original.target }).toEqual(original);
  });

  test('zooms to the pointer with the wheel and keeps its target-plane point there', async ({
    page,
  }) => {
    const box = await start3d(page);
    const [x, y] = [Math.round(box.x + box.width * 0.7), Math.round(box.y + box.height * 0.3)];
    const before = await camera3d(page);
    const under = targetPlaneAt(before, box, x, y);
    await page.evaluate(() => {
      (window as unknown as { wheels: boolean[] }).wheels = [];
      window.addEventListener('wheel', (event) => {
        (window as unknown as { wheels: boolean[] }).wheels.push(event.defaultPrevented);
      });
    });
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await camera3d(page)).distance).toBeLessThan(before.distance);
    const after = await camera3d(page);
    const stillUnder = targetPlaneAt(after, box, x, y);
    stillUnder.forEach((value, axis) => {
      near(value, under[axis] ?? NaN);
    });
    expect(after.target).not.toEqual(before.target);
    expect({ ...after, target: before.target, distance: before.distance }).toEqual(before);
    expect(await page.evaluate(() => (window as unknown as { wheels: boolean[] }).wheels)).toEqual([
      true,
    ]);
  });
});
