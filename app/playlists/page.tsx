import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Playlists",
};

export default function PlaylistsPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Playlists</h1>
      <p className="mt-2 text-muted-foreground">
        Playlists you create through the app will be listed here.
      </p>
    </section>
  );
}
