/**
 * Wire-contract constants shared across routes.
 *
 * GENERIC_SUBJECT_IDS: subjectId literals that mean "an unidentified bird of
 * this kind" (P2-D8) rather than a named individual. They are exempt from the
 * residency warn on submission, merged onto one shared worksheet in both
 * Excel generators, and — enforced by the admin API (Phase 3 §3) — can never
 * be used as a real subject's name. Must stay in lockstep with the form
 * repo's GENERIC_JUVENILE_ID.
 */
export const GENERIC_SUBJECT_IDS = new Set(['Juvenile']);
