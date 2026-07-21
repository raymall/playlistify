import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Library",
};

export default function LibraryPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
      <p className="mt-2 text-muted-foreground">
        Your imported Liked Songs will live here.
      </p>
    </section>
  );
}
