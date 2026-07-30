import { requestSongRecheck } from '@/lib/enrichment/recipes'
import { createAdminClient } from '@/lib/supabase/admin'

export const requestEnrichmentRecheck = (userId: string, songId: string) =>
  requestSongRecheck(createAdminClient(), userId, songId)
