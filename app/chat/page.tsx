import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chat",
};

export default function ChatPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Chat</h1>
      <p className="mt-2 text-muted-foreground">
        Describe the playlist you want; the conversation starts here.
      </p>
    </section>
  );
}
