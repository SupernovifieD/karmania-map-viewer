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
  roles.map((role, index) => ({
    source: `C${String(index)}`,
    role,
    suggested: false,
    type: undefined,
    rename: '',
  }));

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

  test('uses the documented hint and example for a coordinate that is not a number, and a name used twice', () => {
    // The names are those of the documented examples, so that the sentences can be the same.
    const E: ColumnDraft = { source: 'E', role: 'x', suggested: false, type: 'text', rename: '' };
    const notNumeric = mappingProblems('points', [E, ...columns('y')], EMPTY_BLOCK_SIZE).find(
      (problem) => problem.code === 'mapping.coordinate.not_numeric',
    );
    const written = documented('mapping.coordinate.not_numeric');
    expect(notNumeric?.hint).toBe(written.hint);
    expect(notNumeric?.message).toBe(written.example);

    const grade = (source: string): ColumnDraft => ({
      source,
      role: 'attribute',
      suggested: false,
      type: undefined,
      rename: 'grade',
    });
    const duplicate = mappingProblems(
      'points',
      [...columns('x', 'y'), grade('Au'), grade('Cu')],
      EMPTY_BLOCK_SIZE,
    ).find((problem) => problem.code === 'table.column.name_duplicate');
    const writtenDuplicate = documented('table.column.name_duplicate');
    expect(duplicate?.hint).toBe(writtenDuplicate.hint);
    expect(duplicate?.message).toBe(writtenDuplicate.example);
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
