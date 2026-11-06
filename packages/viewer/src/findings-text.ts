import type { Finding, Location, Severity } from '@karmania/engine';
import { formatCount } from './import-files.js';

/** What each severity is called, for people: an error, a warning, a note. */
export const SEVERITY_NAMES: Readonly<Record<Severity, string>> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
};

/** Where something was, in words: `line 1,203`, `row 4`, `column "Au"`, `cell (2, 5, 0)`. */
export function describeLocation(location: Location): string {
  const parts: string[] = [];
  if (location.line !== undefined) {
    parts.push(`line ${formatCount(location.line)}`);
  }
  if (location.row !== undefined) {
    parts.push(`row ${formatCount(location.row + 1)}`);
  }
  if (location.element !== undefined) {
    parts.push(`element ${formatCount(location.element + 1)}`);
  }
  if (location.vertex !== undefined) {
    parts.push(`vertex ${formatCount(location.vertex + 1)}`);
  }
  if (location.column !== undefined) {
    parts.push(`column "${location.column}"`);
  }
  if (location.cell !== undefined) {
    parts.push(`cell (${location.cell.join(', ')})`);
  }
  return parts.join(' ');
}

/** `a`, `a and b`, `a, b and c`. */
function joined(items: readonly string[]): string {
  const last = items.at(-1);
  if (last === undefined || items.length === 1) {
    return last ?? '';
  }
  return `${items.slice(0, -1).join(', ')} and ${last}`;
}

/** How many places are named before the rest are counted. */
const PLACES_SHOWN = 3;

/**
 * How often a finding happened and where, for one that happened more than once: `Seen 12 times: line
 * 3, line 8, line 15 and 9 more.` One that happened once has its place in its message, and nothing is
 * said twice.
 */
export function describeOccurrences(finding: Finding): string | undefined {
  if (finding.count <= 1) {
    return undefined;
  }
  const places = finding.examples
    .slice(0, PLACES_SHOWN)
    .map(describeLocation)
    .filter((place) => place !== '');
  const head = `Seen ${formatCount(finding.count)} times`;
  if (places.length === 0) {
    return `${head}.`;
  }
  const more = finding.count - places.length;
  return more > 0
    ? `${head}: ${places.join(', ')} and ${formatCount(more)} more.`
    : `${head}: ${joined(places)}.`;
}
