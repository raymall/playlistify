import { PageSection } from '@/components/page-section'
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
 * Instant shell for /library while the page's queries run. Mirrors the
 * returning-user layout (header, import + enrichment panels, search, table) so
 * the real content swaps in without shifting.
 *
 * This fallback only paints because the root layout and SiteHeader read no
 * runtime data of their own — adding cookies()/getUser() to the layout would
 * suppress it (see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/loading.md).
 */
export default function LibraryLoading() {
  return (
    <PageSection>
      <div aria-hidden='true'>
        <header className='flex flex-col gap-1'>
          <Skeleton className='h-9 w-40' />
          <Skeleton className='h-6 w-24' />
        </header>

        <div className='mt-8 flex flex-col gap-4'>
          <Skeleton className='h-9 w-44' />
          <div className='mt-6 flex flex-col gap-4 border-t border-border pt-6'>
            <div className='flex flex-wrap items-end gap-3'>
              <div className='flex flex-col gap-1.5'>
                <Skeleton className='h-4 w-12' />
                <Skeleton className='h-9 w-56' />
              </div>
              <Skeleton className='h-9 w-36' />
            </div>
            <Skeleton className='h-4 w-full max-w-prose' />
          </div>
        </div>

        <div className='mt-10 flex flex-col gap-4'>
          <div className='flex max-w-md items-center gap-2'>
            <Skeleton className='h-9 flex-1' />
            <Skeleton className='h-9 w-20' />
          </div>

          <Table className='table-fixed'>
            <TableHeader>
              <TableRow>
                <TableHead className='w-16' scope='col'>
                  <span className='sr-only'>Artwork</span>
                </TableHead>
                <TableHead scope='col'>Title</TableHead>
                <TableHead scope='col'>Artists</TableHead>
                <TableHead className='w-2/5' scope='col'>
                  Tags
                </TableHead>
                <TableHead className='w-32 text-right' scope='col'>
                  Accuracy
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLACEHOLDER_ROWS.map((key) => (
                <TableRow key={key}>
                  <TableCell>
                    <Skeleton className='size-10' />
                  </TableCell>
                  <TableCell>
                    <Skeleton className='h-4 w-3/4' />
                  </TableCell>
                  <TableCell>
                    <Skeleton className='h-4 w-2/3' />
                  </TableCell>
                  <TableCell>
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
      </div>

      <span className='sr-only' role='status'>
        Loading your library
      </span>
    </PageSection>
  )
}
