import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CURRENT_TERMS_VERSION } from './legal.js';
import { OPERATOR_POSTAL_ADDRESS } from './lifecycleEmail.js';

/**
 * The two version constants must agree (Step 6c, re-checked at 6g).
 *
 * `CURRENT_TERMS_VERSION` here is what the consent gate compares an account's
 * recorded consent against; `DOCUMENT_VERSION` in the client is what the
 * published documents display and what a teacher is therefore agreeing to. The
 * two drifting apart either re-prompts everybody for nothing or records consent
 * against a version string that maps back to no text at all — and neither
 * failure shows up anywhere until an account is asked to consent again.
 *
 * Read out of the client's source as text rather than imported. The client is a
 * separate package with its own tsconfig and a DOM lib; importing across the
 * boundary would pull server source into the client's type program (or the
 * reverse) to guard one string, and this project has no `shared/` directory by
 * deliberate choice. A regex over one `export const` line is the smaller cost.
 */
const LEGAL_META = fileURLToPath(
  new URL('../../../client/src/pages/legal/legalMeta.ts', import.meta.url),
);

describe('legal document versions', () => {
  it('matches DOCUMENT_VERSION in the client', () => {
    const source = readFileSync(LEGAL_META, 'utf8');
    const match = /export const DOCUMENT_VERSION = '([^']+)'/.exec(source);

    // A rename or a move of the client constant must fail loudly here rather
    // than quietly stop checking anything.
    expect(match, `DOCUMENT_VERSION not found in ${LEGAL_META}`).not.toBeNull();
    expect(match?.[1]).toBe(CURRENT_TERMS_VERSION);
  });
});

/**
 * The lifecycle email footer and the two legal documents print the operator's
 * mailing address from separate constants, one per package, for the same reason
 * the version check above reads source as text. Step 8c fills both in at once;
 * this is what stops one being filled in, or corrected, without the other.
 */
describe('operator postal address', () => {
  it('matches OPERATOR_POSTAL_ADDRESS in the client', () => {
    const source = readFileSync(LEGAL_META, 'utf8');
    const match = /export const OPERATOR_POSTAL_ADDRESS = '([^']*)'/.exec(source);

    expect(match, `OPERATOR_POSTAL_ADDRESS not found in ${LEGAL_META}`).not.toBeNull();
    expect(match?.[1]).toBe(OPERATOR_POSTAL_ADDRESS);
  });
});
