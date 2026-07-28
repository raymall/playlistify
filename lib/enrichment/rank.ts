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

/**
 * How many times a model may leave a song out of its batch response before the
 * engine gives up on it at that rank. Omitted songs are never written, so
 * without this they are re-selected — and re-billed as prompt tokens — on every
 * batch forever. Giving up records the rank in `songs.enrichment_skipped_rank`
 * and resets the counter, so a strictly stronger model starts over with a full
 * allowance rather than inheriting an exhausted one.
 */
export const MAX_ENRICHMENT_ATTEMPTS = 3
