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
 * heading, "would stop being drawn"). What is left starts a sentence there, and the engine's words start with a small letter after the colon
 * (`a local grid has no known place`): it is given a capital.
 */
export function withoutNotDrawn(reason: string): string {
  const rest = reason.replace(/^Not drawn:\s*/, '');
  return rest === reason ? reason : `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
}
