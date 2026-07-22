// Regenerates lib/supabase/types.ts from the linked remote schema, exactly
// as committed: public schema only, the eslint-disable header re-prepended,
// prettier-formatted. Raw `supabase gen types` output fails lint (double
// quotes, index-signature style) and includes a graphql_public section the
// committed file doesn't have — always regenerate through this script.
//
// Usage: npm run gen:types
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const OUT_FILE = 'lib/supabase/types.ts'

const HEADER = `/* eslint-disable */
// Generated from the live Supabase schema — do not edit by hand.
// Regenerate with: npm run gen:types (wraps supabase gen types + this header + prettier).
`

const generated = execFileSync(
  'npx',
  ['supabase', 'gen', 'types', 'typescript', '--linked', '--schema', 'public'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
)

// Refuse to clobber the committed file with empty/partial CLI output.
if (!generated.includes('export type Database')) {
  console.error('supabase gen types returned unexpected output — types.ts left untouched.')
  process.exit(1)
}

writeFileSync(OUT_FILE, HEADER + generated)
execFileSync('npx', ['prettier', '--write', OUT_FILE], { stdio: 'inherit' })
