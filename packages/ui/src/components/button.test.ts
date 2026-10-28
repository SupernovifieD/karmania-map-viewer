import { describe, expect, it } from 'vitest';
import { kButton } from './button.js';
import type { ButtonProps } from './button.js';

/** These are checked by `tsc` (the typecheck script): each `@ts-expect-error` must be an error. */
describe('the properties of a button', () => {
  it('are words, with or without an icon, or an icon with a label', () => {
    const words: ButtonProps = { children: 'Import' };
    const wordsWithIcon: ButtonProps = { children: 'Import', icon: 'upload', variant: 'primary' };
    const iconAlone: ButtonProps = { icon: 'x', label: 'Close', size: 28 };
    expect([words, wordsWithIcon, iconAlone]).toHaveLength(3);
  });

  it('do not compile for an icon alone without a label', () => {
    // @ts-expect-error an icon alone has no name for people who cannot see it
    const unnamed: ButtonProps = { icon: 'x' };
    // @ts-expect-error nor has a button with nothing in it
    const empty: ButtonProps = {};
    // @ts-expect-error nor a button with only a look
    const onlyLook: ButtonProps = { variant: 'primary' };
    expect([unnamed, empty, onlyLook]).toHaveLength(3);
  });

  it('do not compile for an icon that does not exist, or a size that is not one', () => {
    // @ts-expect-error there is no such icon
    const noIcon: ButtonProps = { icon: 'nope', label: 'x' };
    // @ts-expect-error the sizes are 28 and 32
    const wrongSize: ButtonProps = { children: 'x', size: 24 };
    // @ts-expect-error the variants are primary, secondary and ghost
    const wrongVariant: ButtonProps = { children: 'x', variant: 'danger' };
    expect([noIcon, wrongSize, wrongVariant]).toHaveLength(3);
  });

  it('make a template with what the button says', () => {
    expect(kButton({ children: 'Import' }).values).toContain('Import');
    expect(kButton({ icon: 'x', label: 'Close' }).values).toContain('Close');
  });
});
