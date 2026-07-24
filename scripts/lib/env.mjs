/**
 * Shared env guard for the DB scripts: returns the values for `keys` in
 * order, or exits 1 with the standard run hint when any is missing.
 *
 * @param {string[]} keys
 * @param {string} [hintSuffix] extra text for the hint, e.g. ' --import tsx'
 * @returns {string[]}
 */
export const requireEnv = (keys, hintSuffix = '') => {
  const values = keys.map((key) => process.env[key] ?? '')
  if (values.some((value) => value === '')) {
    console.error(
      `Missing env vars — run with: node --env-file=.env.local${hintSuffix}`,
    )
    process.exit(1)
  }
  return values
}
