import { createAdminClient } from "@/lib/supabase/admin";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Refresh when within this window of expiry. */
const EXPIRY_BUFFER_MS = 60_000;

export type SpotifyTokenResult =
  | { status: "ok"; accessToken: string }
  /**
   * No usable tokens (row missing, or Spotify returned invalid_grant —
   * refresh tokens expire after 6 months of inactivity). The UI should
   * prompt "Reconnect Spotify"; a fresh sign-in re-captures tokens.
   */
  | { status: "reconnect_required" }
  | { status: "error"; message: string };

/**
 * Returns a valid Spotify access token for the user, refreshing against
 * Spotify when expired. Server-side only (service-role reads).
 */
export async function getValidSpotifyToken(
  userId: string,
): Promise<SpotifyTokenResult> {
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("spotify_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!row) return { status: "reconnect_required" };

  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt - EXPIRY_BUFFER_MS > Date.now()) {
    return { status: "ok", accessToken: row.access_token };
  }

  const basic = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });

  if (!response.ok) {
    let payload: { error?: string } = {};
    try {
      payload = await response.json();
    } catch {
      // non-JSON error body; fall through to generic error
    }
    if (payload.error === "invalid_grant") {
      // Token revoked or expired. Deleting the row makes "row missing" the
      // single reconnect-required signal the UI checks.
      await admin.from("spotify_tokens").delete().eq("user_id", userId);
      return { status: "reconnect_required" };
    }
    return {
      status: "error",
      message: `Spotify token refresh failed (HTTP ${response.status})`,
    };
  }

  const json = (await response.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const { error: updateError } = await admin
    .from("spotify_tokens")
    .update({
      access_token: json.access_token,
      // Spotify may rotate the refresh token; keep the old one otherwise.
      refresh_token: json.refresh_token ?? row.refresh_token,
      expires_at: new Date(
        Date.now() + (json.expires_in - 60) * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (updateError) return { status: "error", message: updateError.message };

  return { status: "ok", accessToken: json.access_token };
}
