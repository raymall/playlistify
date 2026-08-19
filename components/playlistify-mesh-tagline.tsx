'use client'

import { useEffect, useRef, useState } from 'react'

import { createTaglineLoop, LANDING_TAGLINES } from '@/lib/landing/taglines'

const CHARACTER_FADE_MS = 180
const CHARACTER_STAGGER_MS = 16
const TAGLINE_DWELL_MS = 3200
const BETWEEN_TAGLINES_MS = 140
const TAGLINE_SEGMENTER = new Intl.Segmenter('en', { granularity: 'grapheme' })

type TaglinePhase = 'entering' | 'exiting' | 'visible'

const splitTagline = (tagline: string) =>
  Array.from(TAGLINE_SEGMENTER.segment(tagline), ({ segment }) => segment)

const splitTaglineWords = (tagline: string) => {
  let characterOffset = 0

  return tagline.split(' ').map((word) => {
    const characters = splitTagline(word)
    const offset = characterOffset
    characterOffset += characters.length + 1
    return { characters, offset }
  })
}

const getFadeSequenceMs = (tagline: string) =>
  Math.max(0, splitTagline(tagline).length - 1) * CHARACTER_STAGGER_MS +
  CHARACTER_FADE_MS

/**
 * Fades each line out character by character before revealing the next one.
 * One shuffled, complete sequence repeats so no line can be skipped.
 */
export const PlaylistifyMeshTagline = () => {
  const slotRef = useRef<HTMLDivElement>(null)
  const [taglineIndex, setTaglineIndex] = useState(0)
  const [phase, setPhase] = useState<TaglinePhase>('visible')

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const slot = slotRef.current
    const loop = createTaglineLoop()
    let loopPosition = 0
    let timeoutId: number | undefined

    const clearTimer = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      timeoutId = undefined
    }

    const scheduleExit = () => {
      if (reducedMotion.matches) return
      timeoutId = window.setTimeout(runExit, TAGLINE_DWELL_MS)
    }

    const runExit = () => {
      if (reducedMotion.matches) return
      const currentIndex = loop[loopPosition]
      setPhase('exiting')

      timeoutId = window.setTimeout(() => {
        timeoutId = window.setTimeout(() => {
          loopPosition = (loopPosition + 1) % loop.length
          const nextIndex = loop[loopPosition]
          setTaglineIndex(nextIndex)
          setPhase('entering')

          timeoutId = window.setTimeout(() => {
            setPhase('visible')
            scheduleExit()
          }, getFadeSequenceMs(LANDING_TAGLINES[nextIndex]))
        }, BETWEEN_TAGLINES_MS)
      }, getFadeSequenceMs(LANDING_TAGLINES[currentIndex]))
    }

    const handleReducedMotionChange = () => {
      clearTimer()
      setTaglineIndex(loop[loopPosition])
      setPhase('visible')
      scheduleExit()
    }

    if (slot !== null) slot.dataset.ready = 'true'
    reducedMotion.addEventListener('change', handleReducedMotionChange)
    scheduleExit()

    return () => {
      clearTimer()
      reducedMotion.removeEventListener('change', handleReducedMotionChange)
      if (slot !== null) delete slot.dataset.ready
    }
  }, [])

  const tagline = LANDING_TAGLINES[taglineIndex]
  const words = splitTaglineWords(tagline)

  return (
    <>
      <p className='sr-only'>{LANDING_TAGLINES[0]}</p>
      <div ref={slotRef} className='mesh-landing-tagline-slot'>
        <div aria-hidden className='mesh-landing-tagline'>
          <p className='mesh-landing-tagline-line' data-phase={phase}>
            {words.map(({ characters, offset }, wordIndex) => (
              <span
                key={`${taglineIndex}-${wordIndex}`}
                className='mesh-landing-tagline-word'
              >
                {characters.map((character, characterIndex) => (
                  <span
                    key={`${taglineIndex}-${wordIndex}-${characterIndex}`}
                    className='mesh-landing-tagline-char'
                    style={{
                      animationDelay: `${(offset + characterIndex) * CHARACTER_STAGGER_MS}ms`,
                    }}
                  >
                    {character}
                  </span>
                ))}
                {wordIndex < words.length - 1 && (
                  <span
                    className='mesh-landing-tagline-char'
                    style={{
                      animationDelay: `${(offset + characters.length) * CHARACTER_STAGGER_MS}ms`,
                    }}
                  >
                    {'\u00a0'}
                  </span>
                )}
              </span>
            ))}
          </p>
        </div>
      </div>
    </>
  )
}
