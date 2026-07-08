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

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

// Null-prototype so a lookup like UPLOAD_CONTENT_TYPES[input] can't resolve
// through Object.prototype ('constructor', 'toString', …) — those inherited
// keys are truthy and would otherwise pass a `!extension` guard. The route
// also validates contentType with z.enum() built from these keys.
export const UPLOAD_CONTENT_TYPES: Record<string, string> = Object.assign(
  Object.create(null),
  {
    "image/webp": "webp",
    "image/png": "png",
    "image/jpeg": "jpg",
  },
);

export const UPLOAD_CONTENT_TYPE_VALUES = [
  "image/webp",
  "image/png",
  "image/jpeg",
] as const;

/** Max upload size the CLIENT enforces before asking for a URL. A presigned
 * PUT binds content type but not length (design §4 — admins are trusted and
 * authenticated; this is a guardrail, not a defense). */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const UPLOAD_URL_TTL_SECONDS = 600;

/** "Eastern Perimeter" → "eastern-perimeter" (same shape as aviary slugs). */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * First versioned key (v1, v2, …) that is not already taken. `isTaken` is the
 * caller's lookup — it must consult current draft rows, published history AND
 * previously-minted-but-unsaved keys (the reservation), so two overlapping
 * mints for the same aviary+label never receive the same key and a bucket
 * object is never overwritten. A hard ceiling guards against a caller whose
 * predicate always returns true (misconfiguration) rather than looping forever.
 */
export async function nextDiagramKey(
  aviarySlug: string,
  label: string,
  extension: string,
  isTaken: (candidate: { key: string; url: string }) => Promise<boolean>,
): Promise<{ key: string; publicUrl: string }> {
  const labelSlug = slugifyLabel(label);
  if (!labelSlug) throw new Error("label produces an empty slug");
  const base = config.r2!.publicBaseUrl;
  for (let n = 1; n <= 10000; n++) {
    const key = `perch-diagram-${aviarySlug}-${labelSlug}-v${n}.${extension}`;
    const publicUrl = `${base}/${key}`;
    if (!(await isTaken({ key, url: publicUrl }))) return { key, publicUrl };
  }
  throw new Error(
    "could not allocate a diagram version — every candidate was taken",
  );
}

/** Presigned PUT URL for the given key — valid for UPLOAD_URL_TTL_SECONDS. */
export async function presignDiagramUpload(
  key: string,
  contentType: string,
): Promise<string> {
  const r2 = config.r2!;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
    // Without this the SDK signs a CRC32 checksum of the EMPTY body into the
    // presigned query — every real upload would then fail checksum validation
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      ContentType: contentType,
      // Storage-layer backstop for the never-overwrite invariant: R2 rejects a
      // PUT with 412 if the key already exists, so even a replayed or racing
      // presigned URL can never overwrite an object frozen into published
      // history. The browser must send this exact header (see uploadToBucket)
      // and the bucket CORS must allow If-None-Match.
      IfNoneMatch: "*",
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // Keep these SIGNED headers (signable AND not hoisted into the query):
      // the browser's PUT must send exactly this content-type and If-None-Match
      // or the signature won't match — the type binding + overwrite guard (§4)
      signableHeaders: new Set(["content-type", "host", "if-none-match"]),
      unhoistableHeaders: new Set(["content-type", "if-none-match"]),
    },
  );
}
