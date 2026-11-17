// Puts into a build what its licences ask to go with it (step 23.5): THIRD_PARTY_NOTICES.md (the licences of three.js, Lit, the icons, the font, the Rust crates, the EPSG
// definitions and the colour data) and LICENSE (Karmania's own, Apache-2.0) next to the JavaScript, and the licence of Inter (OFL.txt) next to the font files, in `assets/`.
// The folder is the first argument (`packages/viewer/dist` without one). It is run after `vite build`, which empties the folder first.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder =
  process.argv[2] === undefined
    ? join(root, 'packages', 'viewer', 'dist')
    : resolve(process.argv[2]);
if (!existsSync(folder)) {
  throw new Error(`${folder} is not there: this is run after the build.`);
}
const copies = [
  [join(root, 'THIRD_PARTY_NOTICES.md'), join(folder, 'THIRD_PARTY_NOTICES.md')],
  [join(root, 'LICENSE'), join(folder, 'LICENSE')],
  [join(root, 'packages', 'ui', 'src', 'fonts', 'OFL.txt'), join(folder, 'assets', 'OFL.txt')],
];
mkdirSync(join(folder, 'assets'), { recursive: true });
for (const [from, to] of copies) {
  copyFileSync(from, to);
  console.log(`notices: ${relative(root, from)} -> ${relative(root, to)}`);
}
