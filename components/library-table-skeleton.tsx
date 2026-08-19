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
      <TableHeader>
        <TableRow>
          <TableHead className='w-22' scope='col'>
            Art
          </TableHead>
          <TableHead className='w-1/3' scope='col'>
            Title / Artist
          </TableHead>
          <TableHead className='hidden w-2/5 md:table-cell' scope='col'>
            Tags
          </TableHead>
          <TableHead className='w-28 text-right' scope='col'>
            Confidence
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {PLACEHOLDER_ROWS.map((key) => (
          <TableRow key={key}>
            <TableCell>
              <Skeleton className='size-16 sm:size-18' />
            </TableCell>
            <TableCell>
              <div className='flex flex-col gap-2'>
                <Skeleton className='h-4 w-3/4' />
                <Skeleton className='h-3 w-2/3' />
              </div>
            </TableCell>
            <TableCell className='hidden md:table-cell'>
              <div className='flex flex-wrap gap-1.5'>
                <Skeleton className='h-5 w-16 rounded-4xl' />
                <Skeleton className='h-5 w-20 rounded-4xl' />
                <Skeleton className='h-5 w-14 rounded-4xl' />
              </div>
            </TableCell>
            <TableCell>
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
