import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  assertAdjacent,
  assertAligned,
  assertNoOverflow,
  assertNoOverlap,
} from './support/layout.js';
import { inEveryLayout, LAYOUTS } from './support/layouts.js';

/** Adds some HTML to the gallery page, in a box of its own that nothing else touches. */
async function inject(page: Page, html: string): Promise<Locator> {
  await page.evaluate((markup) => {
    document.querySelector('#fixture')?.remove();
    const box = document.createElement('div');
    box.id = 'fixture';
    box.style.cssText =
      'position: fixed; left: 0; top: 0; width: 700px; height: 400px; background: white;';
    box.innerHTML = markup;
    document.body.append(box);
  }, html);
  return page.locator('#fixture');
}

const wide = (style: string, inner = '<div style="width: 300px; height: 20px"></div>'): string =>
  `<div id="subject" style="${style}">${inner}</div>`;

test.describe('assertNoOverflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery.html');
  });

  test('passes a layout where everything fits', async ({ page }) => {
    const root = await inject(
      page,
      '<div style="display: flex; gap: 8px"><span>one</span><span>two</span></div>',
    );
    await assertNoOverflow(root);
  });

  test('fails content wider than its box, and says which element and by how much', async ({
    page,
  }) => {
    const root = await inject(page, wide('width: 100px; overflow: hidden'));
    await expect(assertNoOverflow(root)).rejects.toThrow(/div#subject/);
    await expect(assertNoOverflow(root)).rejects.toThrow(/200px wider than it is/);
  });

  test('fails content taller than its box', async ({ page }) => {
    const root = await inject(
      page,
      wide('height: 20px; overflow: hidden', '<div style="height: 90px">tall</div>'),
    );
    await expect(assertNoOverflow(root)).rejects.toThrow(/70px taller than it is/);
  });

  test('fails content that overflows without being clipped, which is still overflow', async ({
    page,
  }) => {
    const root = await inject(page, wide('width: 100px'));
    await expect(assertNoOverflow(root)).rejects.toThrow(/wider than it is/);
  });

  test('looks inside shadow roots, and names the component the element is in', async ({ page }) => {
    const root = await inject(page, '<div id="host"></div>');
    await page.evaluate(() => {
      const shadow = document.querySelector('#host')?.attachShadow({ mode: 'open' });
      if (shadow) {
        shadow.innerHTML =
          '<div class="inner" style="width: 50px; overflow: hidden"><div style="width: 200px; height: 5px"></div></div>';
      }
    });
    await expect(assertNoOverflow(root)).rejects.toThrow(/div\.inner \(in div#host\)/);
  });

  test('tolerates a pixel of rounding, but not two', async ({ page }) => {
    await assertNoOverflow(
      await inject(
        page,
        wide('width: 100px; overflow: hidden', '<div style="width: 101px; height: 5px"></div>'),
      ),
    );
    await expect(
      assertNoOverflow(
        await inject(
          page,
          wide('width: 100px; overflow: hidden', '<div style="width: 102px; height: 5px"></div>'),
        ),
      ),
    ).rejects.toThrow(/wider/);
  });

  test('lets a scroll region scroll, and an ellipsis cut its text', async ({ page }) => {
    await assertNoOverflow(
      await inject(
        page,
        wide('width: 100px; overflow: auto').replace(
          'id="subject"',
          'id="subject" data-scroll-region',
        ),
      ),
    );
    await assertNoOverflow(
      await inject(
        page,
        '<div id="subject" data-truncate style="width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">A long piece of text</div>',
      ),
    );
  });

  test('still checks what is inside a scroll region, which must not overflow it in turn', async ({
    page,
  }) => {
    const root = await inject(
      page,
      '<div data-scroll-region style="width: 200px; height: 50px; overflow: auto"><div id="cell" style="width: 60px; overflow: hidden"><div style="width: 150px; height: 5px"></div></div></div>',
    );
    await expect(assertNoOverflow(root)).rejects.toThrow(/div#cell/);
  });

  test('fails an element outside the window, and says which edge', async ({ page }) => {
    const past = await inject(
      page,
      '<div id="out" style="position: fixed; left: 1000px; top: 10px; width: 60px; height: 20px"></div>',
    );
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(assertNoOverflow(past)).rejects.toThrow(/div#out.*260px past the right edge/s);
    const left = await inject(
      page,
      '<div id="out" style="position: fixed; left: -30px; top: 10px; width: 60px; height: 20px"></div>',
    );
    await expect(assertNoOverflow(left)).rejects.toThrow(/30px past the left edge/);
    const below = await inject(
      page,
      '<div id="out" style="position: fixed; left: 10px; top: 590px; width: 60px; height: 40px"></div>',
    );
    await expect(assertNoOverflow(below)).rejects.toThrow(/30px past the bottom edge/);
  });

  test('can leave the bottom edge to a page that scrolls, and the window out altogether', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const below = await inject(
      page,
      '<div id="out" style="position: fixed; left: 10px; top: 590px; width: 60px; height: 40px"></div>',
    );
    await assertNoOverflow(below, { window: 'horizontal' });
    await assertNoOverflow(below, { window: 'none' });
    const right = await inject(
      page,
      '<div id="out" style="position: fixed; left: 790px; top: 10px; width: 60px; height: 20px"></div>',
    );
    await expect(assertNoOverflow(right, { window: 'horizontal' })).rejects.toThrow(/right edge/);
    await assertNoOverflow(right, { window: 'none' });
  });

  test('lets what is scrolled out of sight inside a scroll region be outside the window', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const root = await inject(
      page,
      '<div data-scroll-region style="width: 200px; height: 50px; overflow: auto"><div style="width: 20px; height: 20px; margin-left: 3000px"></div></div>',
    );
    await assertNoOverflow(root);
  });

  test('ignores what is not shown, however far out it is', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    const root = await inject(
      page,
      [
        '<div style="display: none; position: fixed; left: 5000px; width: 50px; height: 50px"></div>',
        '<div style="visibility: hidden; position: fixed; left: 5000px; width: 50px; height: 50px"></div>',
        '<div hidden style="position: fixed; left: 5000px; width: 50px; height: 50px"></div>',
        '<div style="display: none; width: 10px; overflow: hidden"><div style="width: 100px; height: 5px"></div></div>',
      ].join(''),
    );
    await assertNoOverflow(root);
  });

  test('lets a native text box scroll its own text', async ({ page }) => {
    const root = await inject(
      page,
      '<input style="width: 30px" value="a value that is much too long to fit" />',
    );
    await assertNoOverflow(root);
  });

  test('only looks inside the element it is given', async ({ page }) => {
    const outside = await inject(
      page,
      `<p id="fine">fine</p><div id="elsewhere">${wide('width: 100px; overflow: hidden')}</div>`,
    );
    await assertNoOverflow(outside.locator('#fine'));
    await expect(assertNoOverflow(outside.locator('#elsewhere'))).rejects.toThrow(/div#subject/);
  });
});

test.describe('assertNoOverlap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery.html');
  });

  const boxes = (a: string, b: string): string =>
    `<div id="a" style="position: absolute; ${a}"></div><div id="b" style="position: absolute; ${b}"></div>`;

  test('passes boxes that are apart, and boxes that only touch', async ({ page }) => {
    const root = await inject(
      page,
      boxes(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 150px; top: 0; width: 100px; height: 50px',
      ),
    );
    await assertNoOverlap(root.locator('#a'), root.locator('#b'));
    const touching = await inject(
      page,
      boxes(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 100px; top: 0; width: 100px; height: 50px',
      ),
    );
    await assertNoOverlap(touching.locator('#a'), touching.locator('#b'));
  });

  test('fails boxes that overlap, and says by how much', async ({ page }) => {
    const root = await inject(
      page,
      boxes(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 90px; top: 20px; width: 100px; height: 50px',
      ),
    );
    await expect(assertNoOverlap(root.locator('#a'), root.locator('#b'))).rejects.toThrow(
      /overlapWidth.*10/s,
    );
    await expect(assertNoOverlap(root.locator('#a'), root.locator('#b'))).rejects.toThrow(
      /overlapHeight.*30/s,
    );
  });

  test('fails a box inside another, and a one-pixel overlap', async ({ page }) => {
    const inside = await inject(
      page,
      boxes(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 10px; top: 10px; width: 20px; height: 20px',
      ),
    );
    await expect(assertNoOverlap(inside.locator('#a'), inside.locator('#b'))).rejects.toThrow(
      /overlap/,
    );
    const sliver = await inject(
      page,
      boxes(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 99px; top: 0; width: 100px; height: 50px',
      ),
    );
    await expect(assertNoOverlap(sliver.locator('#a'), sliver.locator('#b'))).rejects.toThrow(
      /overlap/,
    );
  });

  test('says when an element is not shown, rather than measuring nothing', async ({ page }) => {
    const root = await inject(
      page,
      '<div id="a" style="width: 10px; height: 10px"></div><div id="b" style="display: none"></div>',
    );
    await expect(assertNoOverlap(root.locator('#a'), root.locator('#b'))).rejects.toThrow(
      /second element is not shown/,
    );
  });
});

test.describe('assertAdjacent', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery.html');
  });

  const pair = (a: string, b: string): string =>
    `<div id="a" style="position: absolute; ${a}"></div><div id="b" style="position: absolute; ${b}"></div>`;

  test('passes a box that starts where the other ends', async ({ page }) => {
    const side = await inject(
      page,
      pair(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 100px; top: 10px; width: 80px; height: 50px',
      ),
    );
    await assertAdjacent(side.locator('#a'), side.locator('#b'));
    const stacked = await inject(
      page,
      pair(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 20px; top: 50px; width: 100px; height: 50px',
      ),
    );
    await assertAdjacent(stacked.locator('#a'), stacked.locator('#b'), 'vertical');
  });

  test('fails a gap or an overlap, and says how big', async ({ page }) => {
    const gap = await inject(
      page,
      pair(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 110px; top: 0; width: 80px; height: 50px',
      ),
    );
    await expect(assertAdjacent(gap.locator('#a'), gap.locator('#b'))).rejects.toThrow(
      /gap between the two elements \(horizontal\)[\s\S]*10/,
    );
    const overlap = await inject(
      page,
      pair(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 90px; top: 0; width: 80px; height: 50px',
      ),
    );
    await expect(assertAdjacent(overlap.locator('#a'), overlap.locator('#b'))).rejects.toThrow(
      /-10/,
    );
  });

  test('fails two boxes that touch only at a corner, since they share no side', async ({
    page,
  }) => {
    const corner = await inject(
      page,
      pair(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 100px; top: 50px; width: 80px; height: 50px',
      ),
    );
    await expect(assertAdjacent(corner.locator('#a'), corner.locator('#b'))).rejects.toThrow(
      /share/,
    );
  });

  test('fails the wrong axis', async ({ page }) => {
    const side = await inject(
      page,
      pair(
        'left: 0; top: 0; width: 100px; height: 50px',
        'left: 100px; top: 0; width: 80px; height: 50px',
      ),
    );
    await expect(
      assertAdjacent(side.locator('#a'), side.locator('#b'), 'vertical'),
    ).rejects.toThrow(/vertical/);
  });
});

test.describe('assertAligned', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery.html');
  });

  const three = (lefts: [number, number, number]): string =>
    lefts
      .map(
        (left, index) =>
          `<div id="e${String(index)}" style="position: absolute; left: ${String(left)}px; top: ${String(index * 40)}px; width: 50px; height: 20px"></div>`,
      )
      .join('');

  test('passes edges that match, and ones that are half a pixel out', async ({ page }) => {
    const root = await inject(page, three([20, 20, 20.4]));
    const all = [root.locator('#e0'), root.locator('#e1'), root.locator('#e2')];
    await assertAligned(all, 'left');
    await assertAligned(all, 'right');
    await assertAligned(all, 'horizontal-centre');
  });

  test('fails an edge that is a pixel out, and lists where each one is', async ({ page }) => {
    const root = await inject(page, three([20, 21, 20]));
    const all = [root.locator('#e0'), root.locator('#e1'), root.locator('#e2')];
    await expect(assertAligned(all, 'left')).rejects.toThrow(
      /positions[\s\S]*20[\s\S]*21[\s\S]*20/,
    );
    await expect(assertAligned(all, 'left')).rejects.toThrow(/spread[\s\S]*1/);
  });

  test('compares tops, bottoms and centres', async ({ page }) => {
    const root = await inject(
      page,
      '<div id="a" style="position: absolute; top: 10px; left: 0; width: 20px; height: 30px"></div><div id="b" style="position: absolute; top: 10px; left: 50px; width: 20px; height: 30px"></div><div id="c" style="position: absolute; top: 15px; left: 100px; width: 20px; height: 20px"></div>',
    );
    const [a, b, c] = [root.locator('#a'), root.locator('#b'), root.locator('#c')];
    await assertAligned([a, b], 'top');
    await assertAligned([a, b], 'bottom');
    await assertAligned([a, b, c], 'vertical-centre');
    await expect(assertAligned([a, b, c], 'top')).rejects.toThrow(/top/);
  });

  test('compares the baselines of text, which a taller or shorter box does not change', async ({
    page,
  }) => {
    const root = await inject(
      page,
      '<div style="display: flex; align-items: center; gap: 8px"><span id="a" style="display:block; height: 32px; line-height: 32px">Import</span><span id="b" style="display:block; height: 28px; line-height: 28px">Import</span><span id="c" style="display:block; height: 40px; line-height: 40px">Import</span></div>',
    );
    await assertAligned([root.locator('#a'), root.locator('#b'), root.locator('#c')], 'baseline');
  });

  test('fails text whose baselines differ', async ({ page }) => {
    const root = await inject(
      page,
      '<div style="display: flex; align-items: flex-start; gap: 8px"><span id="a" style="display:block; height: 32px; line-height: 32px">Import</span><span id="b" style="display:block; height: 28px; line-height: 28px">Import</span></div>',
    );
    await expect(
      assertAligned([root.locator('#a'), root.locator('#b')], 'baseline'),
    ).rejects.toThrow(/baseline/);
  });

  test('says when there is no text to take a baseline from', async ({ page }) => {
    const root = await inject(page, '<div id="a" style="width: 10px; height: 10px"></div>');
    await expect(assertAligned([root.locator('#a')], 'baseline')).rejects.toThrow(/no text/);
  });
});

test.describe('the gallery, at every window size and in both themes', () => {
  const SECTIONS = ['icons', 'buttons', 'tabs', 'tooltips'];

  test('has no overflow in any section', async ({ page }) => {
    await inEveryLayout(page, '/gallery.html', async () => {
      for (const section of SECTIONS) {
        // The gallery scrolls down, so only the sides of the window are checked.
        await assertNoOverflow(page.locator(`[data-section="${section}"]`), {
          window: 'horizontal',
        });
      }
    });
    expect(LAYOUTS).toHaveLength(6);
  });

  test('puts the buttons of a row on one baseline, one centre line and one top', async ({
    page,
  }) => {
    await page.goto('/gallery.html');
    for (const size of ['32', '28']) {
      for (const variant of ['primary', 'secondary', 'ghost']) {
        const row = (kind: string) =>
          page.locator(
            `div[data-variant="${variant}"][data-size="${size}"][data-kind="${kind}"] k-button`,
          );
        const kinds = ['text', 'icon-text', 'icon-only', 'disabled', 'icon-only-disabled'];
        // All centred on one line; the ones of the same height share a top as well (an icon
        // alone is at least as high as a hit target, so a compact one is taller than its words).
        await assertAligned(kinds.map(row), 'vertical-centre');
        await assertAligned(['text', 'icon-text', 'disabled'].map(row), 'top');
        await assertAligned(['text', 'icon-text', 'disabled'].map(row), 'baseline');
      }
    }
  });
});
