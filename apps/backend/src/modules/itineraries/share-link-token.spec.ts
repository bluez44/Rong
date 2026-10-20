import { describe, expect, it } from 'vitest';

import { isTokenShape } from '../groups/tokens.js';
import { shareLinkToken } from './share-link-token.js';

const SECRET = 'x'.repeat(32);
const ID = '7d9c1f0e-4b7a-4c51-9a35-1c2b3d4e5f60';

describe('shareLinkToken', () => {
  it('cùng bí mật và id thì cùng token, đúng dạng token', () => {
    const token = shareLinkToken(SECRET, ID);
    expect(token).toBe(shareLinkToken(SECRET, ID));
    expect(isTokenShape(token)).toBe(true);
  });

  it('khác id hoặc khác bí mật thì khác token', () => {
    const token = shareLinkToken(SECRET, ID);
    expect(
      shareLinkToken(SECRET, '00000000-0000-4000-8000-000000000000'),
    ).not.toBe(token);
    expect(shareLinkToken('y'.repeat(32), ID)).not.toBe(token);
  });
});
