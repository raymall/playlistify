import { type ReactNode } from 'react'

interface PageSectionProps {
  children: ReactNode
}

/** Shared width/gutter/rhythm shell for the authenticated pages. */
export const PageSection = ({ children }: PageSectionProps) => (
  <section className='mx-auto w-full max-w-6xl px-4 py-16 sm:px-6'>
    {children}
  </section>
)
