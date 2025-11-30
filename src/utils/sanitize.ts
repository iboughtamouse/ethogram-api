/**
 * Sanitization utilities for filenames and other user input.
 */

/** Remove characters unsafe for filenames */
export function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9-_]/g, '_');
}
