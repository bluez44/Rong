import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RecommendationsConfig } from '../../config/configuration.js';

export const RECOMMENDATIONS_CONFIG = 'RECOMMENDATIONS_CONFIG';
export const UNSPLASH_FETCH = 'UNSPLASH_FETCH';

const SEARCH_URL = 'https://api.unsplash.com/search/photos';
const TIMEOUT_MS = 10_000;
/** Unsplash yêu cầu link về tác giả và ảnh kèm UTM của ứng dụng. */
const UTM = 'utm_source=rong&utm_medium=referral';

export interface UnsplashPhoto {
  url: string;
  width: number;
  height: number;
  author: string;
  authorUrl: string;
  pageUrl: string;
}

const withUtm = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM}`;

/** Cổng duy nhất tới Unsplash API (ảnh vùng cho thẻ gợi ý). */
@Injectable()
export class UnsplashClient {
  constructor(
    @Inject(RECOMMENDATIONS_CONFIG) private readonly config: RecommendationsConfig,
    @Optional() @Inject(UNSPLASH_FETCH) private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return !!this.config.unsplashAccessKey;
  }

  async searchLandscape(query: string): Promise<UnsplashPhoto | null> {
    if (!this.enabled) return null;
    const headers = { Authorization: `Client-ID ${this.config.unsplashAccessKey}` };
    const res = await this.fetchImpl(
      `${SEARCH_URL}?query=${encodeURIComponent(query)}&orientation=landscape&per_page=1`,
      {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`Unsplash trả HTTP ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{
        width: number;
        height: number;
        urls: { regular: string };
        links: { html: string; download_location: string };
        user: { name: string; links: { html: string } };
      }>;
    };
    const photo = body.results?.[0];
    if (!photo) return null;
    // Điều khoản API: báo một lượt "tải" khi ảnh được dùng.
    await this.fetchImpl(photo.links.download_location, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
    return {
      url: photo.urls.regular,
      width: photo.width,
      height: photo.height,
      author: photo.user.name,
      authorUrl: withUtm(photo.user.links.html),
      pageUrl: withUtm(photo.links.html),
    };
  }
}
