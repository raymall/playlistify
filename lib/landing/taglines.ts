export const LANDING_TAGLINES = [
  "You already found the songs. We'll find the playlist.",
  'Playlists made only from songs you already love.',
  'Rediscover the music you already love.',
  "You don't need new music. You need your music, curated.",
  'Liked. Curated. Played.',
  'No discovery. No filler. Just the songs you already liked.',
  'Thousands of liked songs. One perfect playlist.',
  "You did the liking. We'll do the rest.",
  'Nothing new. Everything you love.',
] as const

/**
 * Keeps the server-rendered first line stable, shuffles every remaining line
 * once, then lets the caller repeat that complete order indefinitely.
 */
export const createTaglineLoop = () => {
  const remaining = LANDING_TAGLINES.slice(1).map((_, index) => index + 1)

  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = remaining[index]
    const swap = remaining[swapIndex]
    remaining[index] = swap
    remaining[swapIndex] = current
  }

  return [0, ...remaining]
}
