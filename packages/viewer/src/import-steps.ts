import type { StepDefinition } from '@karmania/ui';

/** The steps of the import wizard, in the order a person goes through them. */
export const IMPORT_STEPS = [
  { id: 'file', label: 'File' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'nodata', label: 'Nodata' },
  { id: 'crs', label: 'CRS' },
  { id: 'review', label: 'Review' },
] as const satisfies readonly StepDefinition[];

/** The name of a step of the import wizard. */
export type ImportStep = (typeof IMPORT_STEPS)[number]['id'];

/** The first step. */
export const FIRST_STEP: ImportStep = 'file';

/** The step after `step`, or `undefined` after the last. */
export function stepAfter(step: ImportStep): ImportStep | undefined {
  const index = IMPORT_STEPS.findIndex((known) => known.id === step);
  return IMPORT_STEPS[index + 1]?.id;
}

/** The step before `step`, or `undefined` before the first. */
export function stepBefore(step: ImportStep): ImportStep | undefined {
  const index = IMPORT_STEPS.findIndex((known) => known.id === step);
  return index > 0 ? IMPORT_STEPS[index - 1]?.id : undefined;
}

/** "Step 2 of 5: Mapping": where a person is, in words, for those who cannot see the indicator. */
export function describeStep(step: ImportStep): string {
  const index = IMPORT_STEPS.findIndex((known) => known.id === step);
  const found = IMPORT_STEPS[index];
  return `Step ${String(index + 1)} of ${String(IMPORT_STEPS.length)}: ${found?.label ?? ''}`;
}
