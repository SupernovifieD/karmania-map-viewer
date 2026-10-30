// The generator behind scripts/generate-fixtures: see there for what it writes and why.
import { copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fixtures', 'generated');
const force = process.argv.includes('--force');

/** A small deterministic generator, the same as the kernel's timing tests use. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

/** Writes `lines`, a few thousand at a time, so that nothing the size of the file is ever in memory. */
async function write(path, header, count, line) {
  if (existsSync(path) && !force) {
    console.log(`kept     ${path} (${(statSync(path).size / 1_048_576).toFixed(1)} MB)`);
    return;
  }
  const stream = createWriteStream(path);
  stream.write(header);
  const chunk = 20_000;
  for (let start = 0; start < count; start += chunk) {
    const lines = [];
    for (let at = start; at < Math.min(count, start + chunk); at += 1) {
      lines.push(line(at));
    }
    if (!stream.write(`${lines.join('\n')}\n`)) {
      await once(stream, 'drain');
    }
  }
  stream.end();
  await once(stream, 'finish');
  console.log(`wrote    ${path} (${(statSync(path).size / 1_048_576).toFixed(1)} MB)`);
}

mkdirSync(out, { recursive: true });

// 1,000,000 points: the same file as the kernel's timing tests build.
const next = generator(42);
const attribute = () => String((next() % 10_000) / 100);
await write(
  join(out, 'points-1m.csv'),
  'X,Y,Z,a0,a1,a2,a3,a4\n',
  1_000_000,
  () =>
    `${String(450_000 + (next() % 100_000))},${String(2_700_000 + (next() % 100_000))},${String(next() % 500)},` +
    `${attribute()},${attribute()},${attribute()},${attribute()},${attribute()}`,
);

// 4,000,000 cells, one row of the file for each row of the grid, with a gap in the data every 97th cell.
const columns = 2000;
const rows = 2000;
let cell = 0;
await write(
  join(out, 'grid-4m.asc'),
  `ncols ${String(columns)}\nnrows ${String(rows)}\nxllcorner 500000\nyllcorner 2765000\ncellsize 10\nNODATA_value -9999\n`,
  rows,
  (row) => {
    const values = [];
    for (let column = 0; column < columns; column += 1) {
      cell += 1;
      values.push(cell % 97 === 0 ? '-9999' : String(((row * 7 + column * 13) % 1000) / 10));
    }
    return values.join(' ');
  },
);

for (const name of ['points-1m', 'grid-4m']) {
  copyFileSync(join(root, 'fixtures', 'points.prj'), join(out, `${name}.prj`));
}
