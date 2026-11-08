/** What a finding says in a sentence, for the places that tell a person why something is not drawn. */
import type { Finding } from '@karmania/engine/types';

/** What a finding says, and what to do about it. */
export function said(finding: Finding | undefined, otherwise: string): string {
  if (finding === undefined) {
    return otherwise;
  }
  const hint = finding.hint ?? '';
  return hint === '' ? finding.message : `${finding.message} ${hint}`;
}

/**
 * A reason without the engine's own opening `Not drawn: `, for the places that have said already that something is not drawn (the summary's
 * heading, "would stop being drawn").
 */
export function withoutNotDrawn(reason: string): string {
  return reason.replace(/^Not drawn:\s*/, '');
}
