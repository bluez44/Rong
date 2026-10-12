import { describe, expect, it } from 'vitest';

import { isValidGooglePlaceId } from './google-place-id.js';

describe('isValidGooglePlaceId', () => {
  it.each(['ChIJN1t_tDeuEmsRUsoyG83frY4', 'abc-DEF_123'])('nhận %s', (id) => {
    expect(isValidGooglePlaceId(id)).toBe(true);
  });
  it.each(['', 'a/b', 'a b', '../x', 'x'.repeat(301), "a'b"])('từ chối %j', (id) => {
    expect(isValidGooglePlaceId(id)).toBe(false);
  });
});
