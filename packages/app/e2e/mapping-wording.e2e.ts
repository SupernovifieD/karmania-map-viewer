import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { EMPTY_BLOCK_SIZE, mappingProblems } from '../src/import-mapping.js';
import type { ColumnDraft } from '../src/import-mapping.js';

/** The documented wording of the kernel's findings, from docs/validation-codes.md. */
const docs = readFileSync(
  fileURLToPath(new URL('../../../docs/validation-codes.md', import.meta.url)),
  'utf8',
);

/** What the documentation says of a finding code: its hint and its example message. */
function documented(code: string): { hint: string; example: string } {
  const start = docs.indexOf(`## \`${code}\``);
  const end = docs.indexOf('\n## ', start + 1);
  const section = docs.slice(start, end === -1 ? undefined : end);
  const field = (name: string): string =>
    section.match(new RegExp(`^- ${name}: (.*)$`, 'm'))?.[1] ?? '';
  return { hint: field('Hint'), example: field('Example') };
}

const columns = (...roles: ColumnDraft['role'][]): ColumnDraft[] =>
  roles.map((role, index) => ({ source: `C${String(index)}`, role, suggested: false }));

// Nothing here opens a page: it checks that the wizard tells a person what the kernel would tell them
// when the file is imported, in the same words.
test.describe('the wizard saying what the kernel says about a mapping', () => {
  test('uses the documented hint and example of each finding it makes before the import', () => {
    const cases = [
      [
        'mapping.coordinate.missing',
        mappingProblems('points', columns('attribute', 'y'), EMPTY_BLOCK_SIZE),
      ],
      ['mapping.line_id.missing', mappingProblems('lines', columns('x', 'y'), EMPTY_BLOCK_SIZE)],
      [
        'mapping.role.duplicate',
        mappingProblems('points', columns('x', 'x', 'y'), EMPTY_BLOCK_SIZE),
      ],
      [
        'mapping.block_size.missing',
        mappingProblems('blocks', columns('x', 'y', 'z'), EMPTY_BLOCK_SIZE),
      ],
    ] as const;
    for (const [code, problems] of cases) {
      const made = problems.find((problem) => problem.code === code);
      const written = documented(code);
      expect(made?.hint, `${code}: hint`).toBe(written.hint);
      expect(made?.message, `${code}: message`).toBe(written.example);
    }
  });

  test('words an unusable block size as documented, with the numbers filled in', () => {
    const written = documented('mapping.block_size.invalid');
    const made = mappingProblems('blocks', columns('x', 'y', 'z'), { x: '10', y: '0', z: '5' })[0];
    expect(made?.hint).toBe(written.hint);
    // The documented example has its own numbers; the rest of the sentence is the same.
    const stem = (text: string): string => text.replace(/but it is .*$/, '');
    expect(stem(made?.message ?? '')).toBe(stem(written.example));
  });
});
