// Slot model for the /library pager. Pure, so the numbering rules are testable
// without rendering: components/library-pagination.tsx only maps slots to
// links.

export type PaginationSlot =
  { kind: 'page'; page: number } | { kind: 'gap'; key: 'start' | 'end' }

/** Pages rendered either side of the current one. */
export const PAGINATION_SIBLING_COUNT = 1

/**
 * Shows only the current page and its immediate siblings. First/last have
 * dedicated controls in the component, so gaps stand in for longer omitted
 * runs without repeating those destinations as numbered links.
 */
export const buildPaginationSlots = (
  page: number,
  pageCount: number,
): PaginationSlot[] => {
  const total = Math.max(1, Math.trunc(pageCount))
  const current = Math.min(Math.max(Math.trunc(page), 1), total)

  const slots: PaginationSlot[] = []
  const start = Math.max(1, current - PAGINATION_SIBLING_COUNT)
  const end = Math.min(total, current + PAGINATION_SIBLING_COUNT)

  if (start > 2) slots.push({ kind: 'gap', key: 'start' })

  for (let value = start; value <= end; value += 1) {
    slots.push({ kind: 'page', page: value })
  }

  if (end < total - 1) slots.push({ kind: 'gap', key: 'end' })

  return slots
}
