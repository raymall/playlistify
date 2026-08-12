'use client'

import { useEffect, useRef } from 'react'

import { LANDING_TAGLINES, pickNextTaglineIndex } from '@/lib/landing/taglines'

const CROSSFADE_OVERLAP = 0.3
const DWELL_SECONDS = 4.2
const ENTER_DURATION = 0.55
const ENTER_STAGGER = 0.55
const EXIT_DURATION = 0.4
const EXIT_STAGGER = 0.45
const FIRST_DWELL_SECONDS = 1.1
const FONT_READY_TIMEOUT_MS = 1500
const MAX_TAGLINE_TRANSITIONS = 2
const SPLIT_OPTIONS = {
  aria: 'none',
  charsClass: 'mesh-landing-tagline-char',
  tag: 'span',
  type: 'words,chars',
  wordsClass: 'mesh-landing-tagline-word',
} as const

const waitForFonts = async () => {
  let timeoutId = 0

  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => {
        timeoutId = window.setTimeout(resolve, FONT_READY_TIMEOUT_MS)
      }),
    ])
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const PlaylistifyMeshTagline = () => {
  const lineARef = useRef<HTMLParagraphElement>(null)
  const lineBRef = useRef<HTMLParagraphElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let isCancelled = false
    let cleanupAnimation = () => undefined

    const setupAnimation = async () => {
      const modulesPromise = Promise.all([
        import('gsap'),
        import('gsap/SplitText'),
      ])

      await waitForFonts()
      const [{ gsap }, { SplitText }] = await modulesPromise
      if (isCancelled) return

      const lineA = lineARef.current
      const lineB = lineBRef.current
      const slot = slotRef.current
      if (!lineA || !lineB || !slot) return

      gsap.registerPlugin(SplitText)

      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      )
      const splits = new Map<HTMLElement, InstanceType<typeof SplitText>>()
      let activeLine = lineA
      let currentIndex = Math.floor(Math.random() * LANDING_TAGLINES.length)
      let delayedCycle: ReturnType<typeof gsap.delayedCall> | undefined
      let idleLine = lineB
      let isDestroyed = false
      let pendingIndex: number | undefined
      let pendingLine: HTMLParagraphElement | undefined
      let timeline: ReturnType<typeof gsap.timeline> | undefined
      let transitionsCompleted = 0

      const clearSplit = (line: HTMLElement) => {
        const split = splits.get(line)
        if (!split) return

        split.revert()
        splits.delete(line)
      }

      const ensureSplit = (line: HTMLElement) => {
        const existingSplit = splits.get(line)
        if (existingSplit) return existingSplit

        const split = new SplitText(line, SPLIT_OPTIONS)
        splits.set(line, split)
        return split
      }

      const settle = () => {
        delayedCycle?.kill()
        delayedCycle = undefined
        timeline?.kill()
        timeline = undefined

        if (pendingLine && pendingIndex !== undefined) {
          const previousActiveLine = activeLine
          activeLine = pendingLine
          idleLine = previousActiveLine
          currentIndex = pendingIndex
          transitionsCompleted += 1
        }

        pendingIndex = undefined
        pendingLine = undefined
        clearSplit(lineA)
        clearSplit(lineB)
        activeLine.textContent = LANDING_TAGLINES[currentIndex]
        idleLine.textContent = ''
      }

      const scheduleCycle = (delay: number) => {
        delayedCycle?.kill()
        delayedCycle = gsap.delayedCall(delay, () => {
          delayedCycle = undefined
          runCycle()
        })
      }

      const runCycle = () => {
        if (
          isDestroyed ||
          reducedMotion.matches ||
          transitionsCompleted >= MAX_TAGLINE_TRANSITIONS
        ) {
          return
        }

        const outgoingLine = activeLine
        const incomingLine = idleLine
        const nextIndex = pickNextTaglineIndex(currentIndex)

        clearSplit(incomingLine)
        incomingLine.textContent = LANDING_TAGLINES[nextIndex]

        const incoming = ensureSplit(incomingLine)
        const outgoing = ensureSplit(outgoingLine)
        pendingIndex = nextIndex
        pendingLine = incomingLine

        timeline = gsap.timeline({
          onComplete: () => {
            timeline = undefined
            clearSplit(outgoingLine)
            outgoingLine.textContent = ''
            activeLine = incomingLine
            idleLine = outgoingLine
            currentIndex = nextIndex
            pendingIndex = undefined
            pendingLine = undefined
            transitionsCompleted += 1

            if (
              !isDestroyed &&
              !reducedMotion.matches &&
              transitionsCompleted < MAX_TAGLINE_TRANSITIONS
            ) {
              scheduleCycle(DWELL_SECONDS)
            }
          },
        })

        timeline.to(outgoing.chars, {
          autoAlpha: 0,
          duration: EXIT_DURATION,
          ease: 'power2.in',
          stagger: { amount: EXIT_STAGGER, from: 'start' },
          yPercent: -55,
        })

        timeline.fromTo(
          incoming.chars,
          { autoAlpha: 0, yPercent: 85 },
          {
            autoAlpha: 1,
            duration: ENTER_DURATION,
            ease: 'power3.out',
            stagger: { amount: ENTER_STAGGER, from: 'start' },
            yPercent: 0,
          },
          `-=${CROSSFADE_OVERLAP}`,
        )
      }

      const startCycling = () => {
        if (
          isDestroyed ||
          reducedMotion.matches ||
          transitionsCompleted >= MAX_TAGLINE_TRANSITIONS ||
          timeline ||
          delayedCycle
        ) {
          return
        }

        ensureSplit(activeLine)
        scheduleCycle(FIRST_DWELL_SECONDS)
      }

      const handleReducedMotionChange = () => {
        if (reducedMotion.matches) {
          settle()
        } else {
          startCycling()
        }
      }

      activeLine.textContent = LANDING_TAGLINES[currentIndex]
      slot.dataset.ready = 'true'
      reducedMotion.addEventListener('change', handleReducedMotionChange)

      if (reducedMotion.matches) {
        settle()
      } else {
        startCycling()
      }

      cleanupAnimation = () => {
        isDestroyed = true
        delayedCycle?.kill()
        timeline?.kill()
        clearSplit(lineA)
        clearSplit(lineB)
        reducedMotion.removeEventListener('change', handleReducedMotionChange)
        delete slot.dataset.ready
      }
    }

    void setupAnimation()

    return () => {
      isCancelled = true
      cleanupAnimation()
    }
  }, [])

  return (
    <>
      <p className='sr-only'>{LANDING_TAGLINES[0]}</p>
      <div ref={slotRef} className='mesh-landing-tagline-slot'>
        <div aria-hidden className='mesh-landing-tagline'>
          <p ref={lineARef} className='mesh-landing-tagline-line'>
            {LANDING_TAGLINES[0]}
          </p>
          <p ref={lineBRef} className='mesh-landing-tagline-line' />
        </div>
      </div>
    </>
  )
}
