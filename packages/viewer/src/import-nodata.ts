import type { DecimalSeparator, NodataSuggestions } from '@karmania/engine';

/** A word that may mean "no data", how often the preview had it, and whether a person has ticked it. */
export interface TokenChoice {
  /** The word; the empty string stands for an empty cell. */
  readonly token: string;
  readonly count: number;
  readonly use: boolean;
}

/** A number that may mean "no data", how often the preview had it, and whether it is ticked. */
export interface NumberChoice {
  readonly value: number;
  readonly count: number;
  readonly use: boolean;
}

/** What a person has decided about the values that mean "no data". */
export interface NodataDraft {
  /** The words the kernel found that look like it, ticked or not. */
  readonly tokens: readonly TokenChoice[];
  /** The numbers the kernel found that look like it, ticked or not. */
  readonly numbers: readonly NumberChoice[];
  /** More values, as typed: separated by commas, numbers written with a point. */
  readonly other: string;
}

/** What to do with a row that has an empty coordinate. */
export type EmptyCoordinates = 'error' | 'skip';

/** Nothing means "no data", and nothing has been suggested. */
export const NO_NODATA: NodataDraft = { tokens: [], numbers: [], other: '' };

/** Everything the kernel suggested is ticked: it is what a person is most likely to want, and nothing is changed silently, since each is counted in a warning. */
export function nodataFromSuggestions(suggestions: NodataSuggestions): NodataDraft {
  return {
    tokens: suggestions.tokens.map((each) => ({ ...each, use: true })),
    numbers: suggestions.numbers.map((each) => ({ ...each, use: true })),
    other: '',
  };
}

/** The choices with one of the words ticked or unticked. */
export function withToken(draft: NodataDraft, index: number, use: boolean): NodataDraft {
  return {
    ...draft,
    tokens: draft.tokens.map((each, at) => (at === index ? { ...each, use } : each)),
  };
}

/** The choices with one of the numbers ticked or unticked. */
export function withNumber(draft: NodataDraft, index: number, use: boolean): NodataDraft {
  return {
    ...draft,
    numbers: draft.numbers.map((each, at) => (at === index ? { ...each, use } : each)),
  };
}

/** A plain number, with a point for the decimals and, if need be, an exponent: `-999`, `1e30`, `.5`. */
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** What was typed as other values: a number when it is one, otherwise a word. Empty parts are nothing. */
export function parseOther(text: string): {
  readonly tokens: readonly string[];
  readonly numbers: readonly number[];
} {
  const tokens: string[] = [];
  const numbers: number[] = [];
  for (const part of text.split(',').map((each) => each.trim())) {
    if (part === '') {
      continue;
    }
    const number = NUMBER.test(part) ? Number(part) : Number.NaN;
    if (Number.isFinite(number)) {
      numbers.push(number);
    } else {
      tokens.push(part);
    }
  }
  return { tokens, numbers };
}

/**
 * The words and numbers that mean "no data", as the import takes them: the ticked ones the kernel
 * suggested and the ones a person typed, each once. Words match whatever the case, so `na` and `NA`
 * are one.
 */
export function nodataOf(draft: NodataDraft): {
  readonly tokens: readonly string[];
  readonly numbers: readonly number[];
} {
  const other = parseOther(draft.other);
  const tokens: string[] = [];
  for (const token of [
    ...draft.tokens.filter((each) => each.use).map((each) => each.token),
    ...other.tokens,
  ]) {
    if (!tokens.some((known) => known.toLowerCase() === token.toLowerCase())) {
      tokens.push(token);
    }
  }
  const numbers = [
    ...new Set([
      ...draft.numbers.filter((each) => each.use).map((each) => each.value),
      ...other.numbers,
    ]),
  ];
  return { tokens, numbers };
}

/** A word as a person reads it in a list: an empty cell is said in words. */
export function tokenLabel(token: string): string {
  return token === '' ? '(empty cell)' : token;
}

/** A number as a person reads it in a list: `-999`, `1e30` (not `1e+30`). */
export function numberLabel(value: number): string {
  return String(value).replace('e+', 'e');
}

/** What each way of writing decimals is called. */
export const DECIMAL_NAMES: Readonly<Record<DecimalSeparator, string>> = {
  '.': 'A point (1.5)',
  ',': 'A comma (1,5)',
};

/** What each choice of what to do with an empty coordinate is called. */
export const EMPTY_COORDINATE_NAMES: Readonly<Record<EmptyCoordinates, string>> = {
  error: 'Stop with an error',
  skip: 'Skip the row, and count it',
};

/** How the values typed as others are read, in words, for under the field. */
export function describeOther(text: string): string {
  const { tokens, numbers } = parseOther(text);
  const parts: string[] = [];
  if (tokens.length > 0) {
    parts.push(
      `the ${tokens.length === 1 ? 'word' : 'words'} ${tokens.map((each) => `"${each}"`).join(', ')}`,
    );
  }
  if (numbers.length > 0) {
    parts.push(
      `the ${numbers.length === 1 ? 'number' : 'numbers'} ${numbers.map(numberLabel).join(', ')}`,
    );
  }
  return parts.length === 0 ? '' : `Read as ${parts.join(' and ')}.`;
}
