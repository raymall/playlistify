/**
 * How a recording is described to the model, field by field. The claimed
 * recipe names its `identity_fields`; this module owns what each one says. A
 * recipe naming a field this build does not know is unsupported, and the
 * batch is released rather than guessed at (`isSupportedRecipe`).
 */

/** The song columns the identity line can draw from. */
export type SongIdentity = {
  title: string | null
  artists: string[] | null
  album: string | null
  releaseDate: string | null
}

type IdentityFieldFormatter = {
  /** Parenthesized fragments render inside the trailing (...) group. */
  isParenthesized: boolean
  format: (song: SongIdentity) => string
}

const IDENTITY_FIELD_FORMATTERS: Record<
  string,
  IdentityFieldFormatter | undefined
> = {
  title: {
    isParenthesized: false,
    format: (song) => `"${song.title ?? 'unknown title'}"`,
  },
  artists: {
    isParenthesized: false,
    format: (song) =>
      `by ${
        song.artists !== null && song.artists.length > 0
          ? song.artists.join(', ')
          : 'unknown artist'
      }`,
  },
  album: {
    isParenthesized: true,
    format: (song) => `album: ${song.album ?? 'unknown'}`,
  },
  release_year: {
    isParenthesized: true,
    format: (song) =>
      `released: ${
        song.releaseDate !== null ? song.releaseDate.slice(0, 4) : 'unknown'
      }`,
  },
}

export const isKnownIdentityField = (field: string): boolean =>
  IDENTITY_FIELD_FORMATTERS[field] !== undefined

/**
 * One song's identity line body, e.g. `"Title" by A, B (album: X,
 * released: 1990)` for the full field set. Unknown fields are skipped —
 * `isSupportedRecipe` refused them before any batch reached this point.
 */
export const describeSongIdentity = (
  song: SongIdentity,
  identityFields: string[],
): string => {
  const head: string[] = []
  const detail: string[] = []
  for (const field of identityFields) {
    const formatter = IDENTITY_FIELD_FORMATTERS[field]
    if (formatter === undefined) continue
    ;(formatter.isParenthesized ? detail : head).push(formatter.format(song))
  }
  return [head.join(' '), detail.length > 0 ? `(${detail.join(', ')})` : '']
    .filter((part) => part !== '')
    .join(' ')
}
