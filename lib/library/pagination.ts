// Slot model for the /library pager. Pure, so the numbering rules are testable
// without rendering: components/library-pagination.tsx only maps slots to
// links.

export type PaginationSlot =
  { kind: 'page'; page: number } | { kind: 'gap'; key: 'start' | 'end' }

/** Pages rendered either side of the current one. */
export const PAGINATION_SIBLING_COUNT = 2

/**
 * Always 1 and `pageCount`, plus `page ± 2`, with a gap wherever the run is
 * discontinuous — except when the gap would replace exactly one number, since
 * an ellipsis is wider than the digit it hides. Nine slots at most.
 */
export const buildPaginationSlots = (
  page: number,
  pageCount: number,
): PaginationSlot[] => {
  const total = Math.max(1, Math.trunc(pageCount))
  const current = Math.min(Math.max(Math.trunc(page), 1), total)

  const pages = new Set([1, total])
  for (
    let offset = -PAGINATION_SIBLING_COUNT;
    offset <= PAGINATION_SIBLING_COUNT;
    offset += 1
  ) {
    const candidate = current + offset
    if (candidate >= 1 && candidate <= total) pages.add(candidate)
  }

  const slots: PaginationSlot[] = []
  let previous = 0
  for (const value of [...pages].sort((a, b) => a - b)) {
    const missing = value - previous - 1
    if (previous > 0 && missing === 1) {
      slots.push({ kind: 'page', page: value - 1 })
    } else if (previous > 0 && missing > 1) {
      slots.push({ kind: 'gap', key: value <= current ? 'start' : 'end' })
    }
    slots.push({ kind: 'page', page: value })
    previous = value
  }
  return slots
}
