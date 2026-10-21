import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ZaloProfileClient,
  zaloAppSecretProof,
} from './zalo-profile.client.js';

const CONFIG = {
  googleClientIds: [],
  zaloAppId: '123',
  zaloAppSecret: 'bi-mat',
};

function client(response: () => Promise<Response>, config = CONFIG) {
  const fetchImpl = vi.fn(response);
  return {
    fetchImpl,
    zalo: new ZaloProfileClient(config, fetchImpl as unknown as typeof fetch),
  };
}
const json = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('ZaloProfileClient', () => {
  it('gửi access_token và appsecret_proof đúng HMAC, trả danh tính không có email', async () => {
    const { fetchImpl, zalo } = client(json(200, { id: '987', name: 'Bình' }));
    await expect(zalo.fetch('tok')).resolves.toEqual({
      provider: 'zalo',
      accountId: '987',
      email: null,
      emailVerified: false,
      displayName: 'Bình',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const proof = createHmac('sha256', 'bi-mat').update('tok').digest('hex');
    expect(url).toBe('https://graph.zalo.me/v2.0/me?fields=id,name');
    expect(init.headers).toMatchObject({
      access_token: 'tok',
      appsecret_proof: proof,
    });
    expect(zaloAppSecretProof('tok', 'bi-mat')).toBe(proof);
  });

  it('HTTP 200 nhưng error khác 0 → EXTERNAL_TOKEN_INVALID', async () => {
    const { zalo } = client(
      json(200, { error: 452, message: 'Access token is invalid' }),
    );
    await expect(zalo.fetch('tok')).rejects.toMatchObject({
      response: { code: 'EXTERNAL_TOKEN_INVALID' },
    });
  });

  it('không có id → EXTERNAL_TOKEN_INVALID', async () => {
    const { zalo } = client(json(200, { name: 'Không id' }));
    await expect(zalo.fetch('tok')).rejects.toMatchObject({
      response: { code: 'EXTERNAL_TOKEN_INVALID' },
    });
  });

  it('HTTP 5xx hoặc lỗi mạng → PROVIDER_UNAVAILABLE', async () => {
    for (const response of [
      json(503, {}),
      () => Promise.reject(new TypeError('fetch failed')),
    ]) {
      const { zalo } = client(response);
      await expect(zalo.fetch('tok')).rejects.toMatchObject({
        response: { code: 'PROVIDER_UNAVAILABLE' },
      });
    }
  });

  it('thiếu App ID hoặc Secret → PROVIDER_NOT_CONFIGURED, không gọi mạng', async () => {
    const { fetchImpl, zalo } = client(json(200, { id: '1' }), {
      ...CONFIG,
      zaloAppSecret: null,
    } as never);
    await expect(zalo.fetch('tok')).rejects.toMatchObject({
      response: { code: 'PROVIDER_NOT_CONFIGURED' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
