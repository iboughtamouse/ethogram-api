/**
 * R2 presigned uploads (Phase 3D, P3-D4): the API mints short-lived presigned
 * PUT URLs for Cloudflare R2's S3-compatible endpoint; the browser uploads
 * image bytes directly, so they never transit the API. Presigning is a local
 * HMAC computation — no network call — which also makes it unit-testable.
 *
 * Object keys follow Phase 1 §8's versioned scheme
 * (`perch-diagram-<aviary-slug>-<label-slug>-v<N>.<ext>`): published config
 * versions freeze URLs into history, so an existing object is NEVER
 * overwritten — a re-upload of the same view gets the next N.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

export const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** Max upload size the CLIENT enforces before asking for a URL. A presigned
 * PUT binds content type but not length (design §4 — admins are trusted and
 * authenticated; this is a guardrail, not a defense). */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const UPLOAD_URL_TTL_SECONDS = 600;

/** "Eastern Perimeter" → "eastern-perimeter" (same shape as aviary slugs). */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * First versioned key (v1, v2, …) whose candidate URL is not already taken.
 * `isTaken` is the caller's lookup against current rows AND published history.
 */
export async function nextDiagramKey(
  aviarySlug: string,
  label: string,
  extension: string,
  isTaken: (url: string) => Promise<boolean>
): Promise<{ key: string; publicUrl: string }> {
  const labelSlug = slugifyLabel(label);
  if (!labelSlug) throw new Error('label produces an empty slug');
  const base = config.r2!.publicBaseUrl;
  for (let n = 1; ; n++) {
    const key = `perch-diagram-${aviarySlug}-${labelSlug}-v${n}.${extension}`;
    const publicUrl = `${base}/${key}`;
    if (!(await isTaken(publicUrl))) return { key, publicUrl };
  }
}

/** Presigned PUT URL for the given key — valid for UPLOAD_URL_TTL_SECONDS. */
export async function presignDiagramUpload(key: string, contentType: string): Promise<string> {
  const r2 = config.r2!;
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
    // Without this the SDK signs a CRC32 checksum of the EMPTY body into the
    // presigned query — every real upload would then fail checksum validation
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      ContentType: contentType,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // Keep content-type a SIGNED HEADER (marked signable AND not hoisted
      // out into the query): the browser's PUT must then send exactly the
      // declared type — the type binding the design promises (§4)
      signableHeaders: new Set(['content-type', 'host']),
      unhoistableHeaders: new Set(['content-type']),
    }
  );
}
