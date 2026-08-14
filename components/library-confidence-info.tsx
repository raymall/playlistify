'use client'

import { InfoIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  CONFIDENCE_BAND_ORDER,
  CONFIDENCE_BANDS,
} from '@/lib/enrichment/confidence'
import {
  RECHECK_BUDGET_COPY,
  RECHECK_SHARED_RESULT_COPY,
} from '@/lib/enrichment/recheck'
import { cn } from '@/lib/utils'

export const LibraryConfidenceInfo = () => (
  <Popover>
    <PopoverTrigger
      aria-label='What Confidence means'
      className={cn(
        buttonVariants({ size: 'icon-xs', variant: 'ghost' }),
        'text-muted-foreground',
      )}
    >
      <InfoIcon aria-hidden='true' className='size-3.5' />
    </PopoverTrigger>
    <PopoverContent align='end'>
      <div className='flex flex-col gap-3 text-left'>
        <div className='flex flex-col gap-1'>
          <PopoverTitle>Confidence</PopoverTitle>
          <p className='text-xs text-muted-foreground'>
            The model&apos;s confidence that it recognized the exact recording.
            This is not measured accuracy.
          </p>
        </div>
        <dl className='flex flex-col gap-1.5 text-xs'>
          {CONFIDENCE_BAND_ORDER.map((band) => (
            <div key={band} className='flex flex-col'>
              <dt className='font-medium text-foreground'>
                {CONFIDENCE_BANDS[band].label}
              </dt>
              <dd className='text-muted-foreground'>
                {CONFIDENCE_BANDS[band].description}
              </dd>
            </div>
          ))}
        </dl>
        <div className='flex flex-col gap-1 border-t border-border pt-3'>
          <PopoverTitle>Re-analyzing</PopoverTitle>
          <p className='text-xs text-muted-foreground'>
            {RECHECK_SHARED_RESULT_COPY}
          </p>
          <p className='text-xs text-muted-foreground'>{RECHECK_BUDGET_COPY}</p>
        </div>
      </div>
    </PopoverContent>
  </Popover>
)
