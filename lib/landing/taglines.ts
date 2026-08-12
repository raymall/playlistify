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

export const pickNextTaglineIndex = (currentIndex: number) => {
  const offset = 1 + Math.floor(Math.random() * (LANDING_TAGLINES.length - 1))
  return (currentIndex + offset) % LANDING_TAGLINES.length
}
