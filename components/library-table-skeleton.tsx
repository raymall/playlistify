import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Stable keys for the static placeholder rows (index-as-key would trip lint).
const PLACEHOLDER_ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

/**
 * Shared by app/library/loading.tsx (cold navigation) and the results
 * Suspense boundary (search, filter, page change), so the two never drift.
 * aria-hidden throughout — the announcement comes from the live regions in
 * LibrarySearchBar and LibraryResults.
 */
export const LibraryTableSkeleton = () => (
  <div aria-hidden='true'>
    <Table className='table-fixed'>
      <colgroup>
        <col className='w-16 sm:w-25' />
        <col />
        <col className='w-0 md:w-2/5' />
        <col className='w-18 sm:w-28' />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead className='px-1.5 sm:px-3' scope='col'>
            Art
          </TableHead>
          <TableHead className='px-1 sm:px-2' scope='col'>
            Title / Artist
          </TableHead>
          <TableHead className='w-0 p-0 md:w-auto md:p-2' scope='col'>
            <span className='hidden md:inline'>Tags</span>
          </TableHead>
          <TableHead
            aria-label='Confidence'
            className='px-0.5 text-right sm:px-2'
            scope='col'
          >
            <span className='sm:hidden'>Conf.</span>
            <span className='hidden sm:inline'>Confidence</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {PLACEHOLDER_ROWS.map((key) => (
          <TableRow key={key}>
            <TableCell className='px-1.5 py-1 sm:px-3 sm:py-2'>
              <Skeleton className='size-12 sm:size-18' />
            </TableCell>
            <TableCell className='py-1 ps-1 pe-0 sm:p-2'>
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-4 w-3/4' />
                <Skeleton className='h-3 w-2/3' />
              </div>
            </TableCell>
            <TableCell className='w-0 p-0 md:w-auto md:p-2'>
              <div className='hidden flex-wrap gap-1.5 md:flex'>
                <Skeleton className='h-5 w-16 rounded-4xl' />
                <Skeleton className='h-5 w-20 rounded-4xl' />
                <Skeleton className='h-5 w-14 rounded-4xl' />
              </div>
            </TableCell>
            <TableCell className='py-1 ps-0 pe-0.5 sm:p-2'>
              <div className='flex justify-end'>
                <Skeleton className='h-5 w-16 rounded-4xl' />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)
