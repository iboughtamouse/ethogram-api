/**
 * Unit tests for the R2 upload service. Presigning is a local HMAC
 * computation, so these run fully offline against the fake credentials
 * injected by vitest.config.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  UPLOAD_URL_TTL_SECONDS,
  nextDiagramKey,
  presignDiagramUpload,
  slugifyLabel,
} from './r2.js';

describe('slugifyLabel', () => {
  it('slugs like aviary slugs', () => {
    expect(slugifyLabel('Eastern Perimeter')).toBe('eastern-perimeter');
    expect(slugifyLabel('North-Western & Central')).toBe('north-western-central');
    expect(slugifyLabel('  SW view (2) ')).toBe('sw-view-2');
    expect(slugifyLabel('Voliére Été')).toBe('voliere-ete');
  });

  it('returns empty for label with no usable characters', () => {
    expect(slugifyLabel('★☆♥')).toBe('');
  });
});

describe('nextDiagramKey', () => {
  it('picks v1 when nothing is taken', async () => {
    const result = await nextDiagramKey('cove', 'Eastern Perimeter', 'webp', async () => false);
    expect(result.key).toBe('perch-diagram-cove-eastern-perimeter-v1.webp');
    expect(result.publicUrl).toBe(
      'https://pub-test.r2.dev/perch-diagram-cove-eastern-perimeter-v1.webp'
    );
  });

  it('skips versions frozen into history — never reuses a URL', async () => {
    const taken = new Set([
      'https://pub-test.r2.dev/perch-diagram-cove-eastern-perimeter-v1.webp',
      'https://pub-test.r2.dev/perch-diagram-cove-eastern-perimeter-v2.webp',
    ]);
    const result = await nextDiagramKey('cove', 'Eastern Perimeter', 'webp', async (url) =>
      taken.has(url)
    );
    expect(result.key).toBe('perch-diagram-cove-eastern-perimeter-v3.webp');
  });
});

describe('presignDiagramUpload', () => {
  it('signs a PUT against the account R2 endpoint with the bound content type', async () => {
    const url = await presignDiagramUpload('perch-diagram-cove-x-v1.webp', 'image/webp');
    const parsed = new URL(url);
    // Virtual-hosted-style addressing (SDK default; R2 supports it)
    expect(parsed.host).toBe('test-bucket.testaccount.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe('/perch-diagram-cove-x-v1.webp');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_TTL_SECONDS));
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
  });
});
