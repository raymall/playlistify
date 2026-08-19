import { type ReactNode } from 'react'

type PageSectionProps = {
  children: ReactNode
}

/** Shared width/gutter/rhythm shell for the authenticated pages. */
export const PageSection = ({ children }: PageSectionProps) => (
  <section className='mx-auto w-full max-w-[100rem] px-4 pt-10 pb-[clamp(7.25rem,calc(14.3vw_+_2rem),16.5rem)] sm:px-6 sm:pt-14 lg:px-10 lg:pt-16'>
    {children}
  </section>
)
