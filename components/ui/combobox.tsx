'use client'

import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { CheckIcon, XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Combobox<Value, Multiple extends boolean | undefined = false>({
  ...props
}: ComboboxPrimitive.Root.Props<Value, Multiple>) {
  return <ComboboxPrimitive.Root data-slot='combobox' {...props} />
}

function ComboboxPortal({ ...props }: ComboboxPrimitive.Portal.Props) {
  return <ComboboxPrimitive.Portal data-slot='combobox-portal' {...props} />
}

function ComboboxPositioner({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: ComboboxPrimitive.Positioner.Props) {
  return (
    <ComboboxPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      className={cn('isolate z-50 outline-none', className)}
      data-slot='combobox-positioner'
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function ComboboxPopup({ className, ...props }: ComboboxPrimitive.Popup.Props) {
  return (
    <ComboboxPrimitive.Popup
      className={cn(
        'z-50 max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
      data-slot='combobox-popup'
      {...props}
    />
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      className={cn(
        'h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground',
        className,
      )}
      data-slot='combobox-input'
      {...props}
    />
  )
}

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      className={cn(
        'flex w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
        className,
      )}
      data-slot='combobox-chips'
      {...props}
    />
  )
}

function ComboboxChip({ className, ...props }: ComboboxPrimitive.Chip.Props) {
  return (
    <ComboboxPrimitive.Chip
      className={cn(
        'flex h-6 items-center gap-1 rounded-4xl border border-border bg-transparent pr-1 pl-2 text-xs font-medium whitespace-nowrap text-foreground',
        className,
      )}
      data-slot='combobox-chip'
      {...props}
    />
  )
}

function ComboboxChipRemove({
  className,
  ...props
}: ComboboxPrimitive.ChipRemove.Props) {
  return (
    <ComboboxPrimitive.ChipRemove
      className={cn(
        // size-6 keeps the remove target at the WCAG 2.2 24px floor.
        'flex size-6 shrink-0 items-center justify-center rounded-4xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      data-slot='combobox-chip-remove'
      {...props}
    >
      <XIcon aria-hidden='true' className='size-3' />
    </ComboboxPrimitive.ChipRemove>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn(
        'max-h-32 w-full overflow-y-auto rounded-lg border border-border p-1 empty:hidden',
        className,
      )}
      data-slot='combobox-list'
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        'relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-6 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        className,
      )}
      data-slot='combobox-item'
      {...props}
    >
      <span
        className='pointer-events-none absolute left-1.5 flex items-center justify-center'
        data-slot='combobox-item-indicator'
      >
        <ComboboxPrimitive.ItemIndicator>
          <CheckIcon className='size-3.5' />
        </ComboboxPrimitive.ItemIndicator>
      </span>
      {children}
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      className={cn(
        'px-1.5 py-1 text-xs text-muted-foreground empty:hidden',
        className,
      )}
      data-slot='combobox-empty'
      {...props}
    />
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      className={cn('empty:hidden', className)}
      data-slot='combobox-group'
      {...props}
    />
  )
}

function ComboboxGroupLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      className={cn(
        'px-1.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase',
        className,
      )}
      data-slot='combobox-group-label'
      {...props}
    />
  )
}

/** Renders the filtered items of the enclosing List or Group. No element. */
function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return <ComboboxPrimitive.Collection {...props} />
}

/**
 * Politely announced status line for asynchronous lists. Must stay mounted —
 * conditionally render its children, never the component, or the announcement
 * is lost.
 */
function ComboboxStatus({
  className,
  ...props
}: ComboboxPrimitive.Status.Props) {
  return (
    <ComboboxPrimitive.Status
      className={cn(
        'px-1.5 py-1 text-xs text-muted-foreground empty:hidden',
        className,
      )}
      data-slot='combobox-status'
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxStatus,
}
