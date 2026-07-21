import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { AccountMenuClient } from "./account-menu-client";

export async function AccountMenu() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // spotify_tokens is service-role only; a missing row is the single
  // "reconnect Spotify" signal (rows are deleted on invalid_grant).
  const admin = createAdminClient();
  const { data: tokenRow } = await admin
    .from("spotify_tokens")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const displayName: string =
    user.user_metadata.full_name ?? user.user_metadata.name ?? "Account";

  return (
    <AccountMenuClient
      displayName={displayName}
      needsReconnect={!tokenRow}
    />
  );
}
