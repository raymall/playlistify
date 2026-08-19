'use client'

import { useEffect, useRef, useState } from 'react'

import { LANDING_TAGLINES, pickNextTaglineIndex } from '@/lib/landing/taglines'

const SCRAMBLE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/#?'
const SCRAMBLE_STEP_MS = 18
const SCRAMBLE_MIN_STEPS = 14
const EXIT_MIN_STEPS = 10
const TAGLINE_DWELL_MS = 1400
const BETWEEN_TAGLINES_MS = 70
const TAGLINE_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' })

const randomCharacter = () =>
  SCRAMBLE_CHARACTERS[Math.floor(Math.random() * SCRAMBLE_CHARACTERS.length)]

const buildScrambleFrame = (target: string, settledCharacters: number) =>
  Array.from(TAGLINE_SEGMENTER.segment(target), ({ segment }) => segment)
    .map((character, index) => {
      if (character === ' ') return ' '
      return index < settledCharacters ? character : randomCharacter()
    })
    .join('')

const buildExitFrame = (source: string, unsettledCharacters: number) => {
  const characters = Array.from(
    TAGLINE_SEGMENTER.segment(source),
    ({ segment }) => segment,
  )
  const scrambleFrom = characters.length - unsettledCharacters

  return characters
    .map((character, index) => {
      if (character === ' ') return ' '
      return index < scrambleFrom ? character : randomCharacter()
    })
    .join('')
}

/**
 * Continuously decodes one landing line into the next. This is deliberately a
 * character scramble rather than a literal airport-board treatment: the copy
 * stays typographic and the existing Wake canvas remains the visual event.
 */
export const PlaylistifyMeshTagline = () => {
  const slotRef = useRef<HTMLDivElement>(null)
  const [displayText, setDisplayText] = useState<string>(LANDING_TAGLINES[0])

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const slot = slotRef.current
    let currentIndex = 0
    let intervalId: number | undefined
    let timeoutId: number | undefined

    const clearTimers = () => {
      if (intervalId !== undefined) window.clearInterval(intervalId)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      intervalId = undefined
      timeoutId = undefined
    }

    const scheduleExit = () => {
      if (reducedMotion.matches) return
      timeoutId = window.setTimeout(runExit, TAGLINE_DWELL_MS)
    }

    const runEnter = (nextIndex: number) => {
      if (reducedMotion.matches) return
      const target = LANDING_TAGLINES[nextIndex]
      const totalSteps = Math.max(
        SCRAMBLE_MIN_STEPS,
        Math.ceil(target.length * 0.7),
      )
      let step = 0

      intervalId = window.setInterval(() => {
        step += 1
        const settledCharacters = Math.floor(
          (step / totalSteps) * target.length,
        )
        setDisplayText(buildScrambleFrame(target, settledCharacters))

        if (step < totalSteps) return
        window.clearInterval(intervalId)
        intervalId = undefined
        currentIndex = nextIndex
        setDisplayText(target)
        scheduleExit()
      }, SCRAMBLE_STEP_MS)
    }

    const runExit = () => {
      if (reducedMotion.matches) return
      const source = LANDING_TAGLINES[currentIndex]
      const totalSteps = Math.max(
        EXIT_MIN_STEPS,
        Math.ceil(source.length * 0.5),
      )
      let step = 0

      intervalId = window.setInterval(() => {
        step += 1
        const unsettledCharacters = Math.ceil(
          (step / totalSteps) * source.length,
        )
        setDisplayText(buildExitFrame(source, unsettledCharacters))

        if (step < totalSteps) return
        window.clearInterval(intervalId)
        intervalId = undefined
        setDisplayText('')
        const nextIndex = pickNextTaglineIndex(currentIndex)
        timeoutId = window.setTimeout(() => {
          runEnter(nextIndex)
        }, BETWEEN_TAGLINES_MS)
      }, SCRAMBLE_STEP_MS)
    }

    const handleReducedMotionChange = () => {
      clearTimers()
      setDisplayText(LANDING_TAGLINES[currentIndex])
      scheduleExit()
    }

    if (slot !== null) slot.dataset.ready = 'true'
    reducedMotion.addEventListener('change', handleReducedMotionChange)
    scheduleExit()

    return () => {
      clearTimers()
      reducedMotion.removeEventListener('change', handleReducedMotionChange)
      if (slot !== null) delete slot.dataset.ready
    }
  }, [])

  return (
    <>
      <p className='sr-only'>{LANDING_TAGLINES[0]}</p>
      <div ref={slotRef} className='mesh-landing-tagline-slot'>
        <div aria-hidden className='mesh-landing-tagline'>
          <p className='mesh-landing-tagline-line'>{displayText}</p>
        </div>
      </div>
    </>
  )
}
