'use client'

import { InfoIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ACCURACY_BAND_ORDER, ACCURACY_BANDS } from '@/lib/enrichment/accuracy'
import { cn } from '@/lib/utils'

/**
 * Explains the Accuracy column. Click-triggered rather than hover, so WCAG
 * 1.4.13 (dismissible / hoverable / persistent) holds by construction; the
 * icon-xs trigger is 24x24, the AA target-size floor.
 */
export const LibraryAccuracyInfo = () => (
  <Popover>
    <PopoverTrigger
      aria-label='What Accuracy means'
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
          <PopoverTitle>Accuracy</PopoverTitle>
          <p className='text-xs text-muted-foreground'>
            How sure the model was that it knew this exact recording. Songs it
            doesn’t recognize get no tags rather than guessed ones.
          </p>
        </div>
        <dl className='flex flex-col gap-1.5 text-xs'>
          {ACCURACY_BAND_ORDER.map((band) => (
            <div key={band} className='flex flex-col'>
              <dt className='font-medium text-foreground'>
                {ACCURACY_BANDS[band].label}
              </dt>
              <dd className='text-muted-foreground'>
                {ACCURACY_BANDS[band].description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </PopoverContent>
  </Popover>
)
