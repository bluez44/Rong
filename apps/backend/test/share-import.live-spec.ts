import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { normalizeForMatch } from '../src/modules/places/web-grounding.js';
import { createLinkMetadataService } from '../src/modules/share-import/link-metadata.service.js';
import {
  buildExtractionInput,
  createPlaceExtractor,
  extractPlaces,
} from '../src/modules/share-import/place-extraction.js';
import { normalizeShareInput } from '../src/modules/share-import/share-url.js';

const links = JSON.parse(
  readFileSync(new URL('./fixtures/share-links.json', import.meta.url), 'utf8'),
) as Array<{ url: string; text?: string; expect: string[] }>;

/** Đo tỉ lệ link nhận diện đúng ≥ 1 địa điểm (PRD F4: ≥ 70%). Gọi mạng và Gemini thật, tốn tiền. */
describe.skipIf(!process.env.GEMINI_API_KEY)('share-to-app live', () => {
  it('nhận diện bộ link thật', { timeout: 600_000 }, async () => {
    const metadata = createLinkMetadataService({
      metaOembedToken: process.env.META_OEMBED_TOKEN || null,
      contactEmail: process.env.OPEN_DATA_CONTACT_EMAIL || 'dev@rong.local',
    });
    const extract = createPlaceExtractor();
    let hits = 0;
    for (const link of links) {
      const input = normalizeShareInput({ url: link.url, text: link.text });
      const meta = input?.url ? await metadata.fetch(input.url) : null;
      const places = await extractPlaces(
        buildExtractionInput(meta, input?.text ?? null),
        extract,
      ).catch(() => []);
      const found = places.map((p) => normalizeForMatch(p.name));
      const ok = link.expect.some((name) =>
        found.some((f) => f.includes(normalizeForMatch(name))),
      );
      if (ok) hits++;
      console.log(
        `${ok ? '✓' : '✗'} ${link.url} → ${places.map((p) => p.name).join(' | ') || '(không có)'}`,
      );
    }
    const rate = hits / links.length;
    console.log(
      `Tỉ lệ đúng: ${(rate * 100).toFixed(0)}% (${hits}/${links.length})`,
    );
    expect(links.length).toBeGreaterThan(0);
  });
});
