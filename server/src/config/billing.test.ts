import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ADVERTISED_PRICES, formatAdvertisedPrice } from './billing.js';

/**
 * Every place the product states a price, tied back to one number.
 *
 * The prices are not settled — the currency, the amounts, and whether they are
 * localised are all open questions — so the failure to guard against is not a
 * wrong number today but a forgotten copy tomorrow. There are three statements
 * of the price in the codebase and they are reached by different routes:
 * `ADVERTISED_PRICES` here, which `assertPricesMatch` compares against the live
 * Stripe Price at startup; the client's `PRICING` strings, which are what a
 * teacher actually reads on the pricing page and the upgrade modal; and the
 * founding-promo lifecycle email, which is now formatted from the constant
 * rather than typed out.
 *
 * The startup check ties the first to Stripe. This file ties the second to the
 * first, which nothing did before — the client's own comment claimed the
 * startup check covered it, and that was never true: the server checks its own
 * constant against Stripe and has never read the client's strings.
 *
 * Read as text rather than imported, for the reason `legal.test.ts` gives: the
 * client is a separate package with a DOM lib, and this project has no `shared/`
 * directory by choice.
 */
const CLIENT_PRICING = fileURLToPath(new URL('../../../client/src/api/billing.ts', import.meta.url));

describe('formatAdvertisedPrice', () => {
  it('renders the minor-unit amount as a teacher reads it', () => {
    expect(formatAdvertisedPrice('monthly')).toBe('$6.99 CAD');
    expect(formatAdvertisedPrice('annual')).toBe('$69.90 CAD');
  });

  /**
   * Guards the arithmetic rather than the figures: a price ending in a zero cent
   * is exactly where a naive formatter drops a digit and advertises $69.9.
   */
  it('keeps both decimal places whatever the amount', () => {
    for (const interval of ['monthly', 'annual'] as const) {
      expect(formatAdvertisedPrice(interval)).toMatch(/^\$\d+\.\d{2} [A-Z]{3}$/);
    }
  });
});

describe('the prices the client displays', () => {
  it('match ADVERTISED_PRICES, which the startup check ties to Stripe', () => {
    const source = readFileSync(CLIENT_PRICING, 'utf8');

    for (const interval of ['monthly', 'annual'] as const) {
      const match = new RegExp(`${interval}:\\s*{[^}]*price:\\s*'([^']+)'`, 's').exec(source);

      // A rename or a restructure of the client constant must fail loudly here
      // rather than quietly stop checking anything.
      expect(match, `${interval} price not found in ${CLIENT_PRICING}`).not.toBeNull();
      expect(match?.[1]).toContain(formatAdvertisedPrice(interval));
    }
  });

  it('states the same currency the server charges in', () => {
    const source = readFileSync(CLIENT_PRICING, 'utf8');
    const currency = ADVERTISED_PRICES.monthly.currency.toUpperCase();
    expect(source).toContain(currency);
  });
});
