// Model-rank comparison, written once so the selector, the engine, and any
// future per-row guard cannot drift apart. Deliberately its own module rather
// than part of lib/ai/models.ts, which carries a pending rename (#19).

/** `songs.enrichment_rank` for a row no model has written yet. */
export const NO_RANK = 0

/**
 * The re-enrichment rule: a song is only rewritten by a model that *strictly*
 * outranks the rank recorded on it. Equal ranks refuse — genuinely
 * incomparable models (different vendors, no eval to order them) share a rank,
 * and refusing is the safe outcome: no downgrade, no wasted tokens.
 */
export const outranks = (modelRank: number, rowRank: number) =>
  modelRank > rowRank
