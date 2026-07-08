/**
 * Unit tests for the R2 upload service. Presigning is a local HMAC
 * computation, so these run fully offline against the fake credentials
 * injected by vitest.config.ts.
 */

import { describe, it, expect } from "vitest";
import {
  UPLOAD_CONTENT_TYPES,
  UPLOAD_URL_TTL_SECONDS,
  nextDiagramKey,
  presignDiagramUpload,
  slugifyLabel,
} from "./r2.js";

describe("UPLOAD_CONTENT_TYPES", () => {
  it("maps the three allowed image types to extensions", () => {
    expect(UPLOAD_CONTENT_TYPES["image/webp"]).toBe("webp");
    expect(UPLOAD_CONTENT_TYPES["image/png"]).toBe("png");
    expect(UPLOAD_CONTENT_TYPES["image/jpeg"]).toBe("jpg");
  });

  it("does NOT resolve inherited Object.prototype keys (null-prototype)", () => {
    for (const key of [
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "toString",
      "valueOf",
    ]) {
      expect(UPLOAD_CONTENT_TYPES[key]).toBeUndefined();
    }
  });
});

describe("slugifyLabel", () => {
  it("slugs like aviary slugs", () => {
    expect(slugifyLabel("Eastern Perimeter")).toBe("eastern-perimeter");
    expect(slugifyLabel("North-Western & Central")).toBe(
      "north-western-central",
    );
    expect(slugifyLabel("  SW view (2) ")).toBe("sw-view-2");
    expect(slugifyLabel("Voliére Été")).toBe("voliere-ete");
  });

  it("returns empty for label with no usable characters", () => {
    expect(slugifyLabel("★☆♥")).toBe("");
  });
});

describe("nextDiagramKey", () => {
  it("picks v1 when nothing is taken", async () => {
    const result = await nextDiagramKey(
      "cove",
      "Eastern Perimeter",
      "webp",
      async () => false,
    );
    expect(result.key).toBe("perch-diagram-cove-eastern-perimeter-v1.webp");
    expect(result.publicUrl).toBe(
      "https://pub-test.r2.dev/perch-diagram-cove-eastern-perimeter-v1.webp",
    );
  });

  it("skips taken keys — never reuses a URL", async () => {
    const taken = new Set([
      "perch-diagram-cove-eastern-perimeter-v1.webp",
      "perch-diagram-cove-eastern-perimeter-v2.webp",
    ]);
    const result = await nextDiagramKey(
      "cove",
      "Eastern Perimeter",
      "webp",
      async ({ key }) => taken.has(key),
    );
    expect(result.key).toBe("perch-diagram-cove-eastern-perimeter-v3.webp");
  });

  it("throws rather than looping forever if every candidate is taken", async () => {
    await expect(
      nextDiagramKey("cove", "X", "webp", async () => true),
    ).rejects.toThrow(/allocate a diagram version/);
  });
});

describe("presignDiagramUpload", () => {
  it("signs a PUT against the account R2 endpoint with the bound content type", async () => {
    const url = await presignDiagramUpload(
      "perch-diagram-cove-x-v1.webp",
      "image/webp",
    );
    const parsed = new URL(url);
    // Virtual-hosted-style addressing (SDK default; R2 supports it)
    expect(parsed.host).toBe(
      "test-bucket.testaccount.r2.cloudflarestorage.com",
    );
    expect(parsed.pathname).toBe("/perch-diagram-cove-x-v1.webp");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe(
      String(UPLOAD_URL_TTL_SECONDS),
    );
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    const signed = parsed.searchParams.get("X-Amz-SignedHeaders");
    // content-type binds the declared type; if-none-match makes the PUT refuse
    // to overwrite an existing (possibly frozen) object at the storage layer
    expect(signed).toContain("content-type");
    expect(signed).toContain("if-none-match");
    // The empty-body CRC32 checksum must NOT be signed into the query, or every
    // real upload would fail checksum validation
    expect(parsed.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  });
});
