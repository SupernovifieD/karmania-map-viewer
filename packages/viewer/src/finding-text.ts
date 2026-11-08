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
