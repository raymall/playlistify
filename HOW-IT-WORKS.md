# How Playlistify works

Plain-language explanation of what the product does and why it decides what it
decides. No setup instructions, no file paths — `ARCHITECTURE.md` is the map of
the code, `MVP-PLAN.md` is the product spec, and this file is the reasoning.

## Library sync

A re-sync converges the library in both directions: it adds newly liked songs,
refreshes saved-song metadata, and removes songs that are no longer in Liked
Songs. Removal happens only after every Spotify page completes. A paused or
failed import never removes anything.

Before removing a song that was not encountered during the completed pass,
Playlistify asks Spotify whether it is still saved. That final confirmation
protects against a song moving between offset-based pages or two browser tabs
syncing at once. Removing the private library row does not erase the shared song
or its cached analysis, so another user—and a future re-like—can reuse it.

## Enrichment

Spotify tells us a song's title, artist, album, and release date. It does not
tell us what the song _feels_ like, and the endpoints that used to hint at that
were closed to new apps. So the app asks a language model instead.

**Enriching a song** means asking what is known about that specific recording
and getting back a small, fixed set of facts: genres, moods, energy, tempo feel,
era, prominent instruments, and a few descriptors. Those answers are what the
chat later searches. A song without trustworthy AI analysis can still be found
through tags a user adds personally.

**Analysis runs in batches** because one request for about twenty songs is
faster and cheaper than twenty separate requests. The app keeps starting small
batches until the eligible part of the library is done or the run reaches its
spending cap. It is resumable: closing the page or pausing after a batch does
not discard completed work.

Before a batch begins, each song gets one shared place in the work queue. If
two people encounter the same song, their requests combine instead of buying
the same analysis twice. A worker holds a temporary lease while it runs; if it
disappears, the lease expires and another visit can safely continue the job.
If the database completes a claim but the network loses its response, the
retry presents the same claim identity and receives the same batch instead of
temporarily reserving a second one.

**Every billable song gets an attempt record.** A response may recognize the
song, honestly say it does not know it, omit it, or fail. The attempt is kept
even when it is not useful, so the app can explain what was tried and avoid
paying for the same recipe again.

Sometimes a model silently omits one song from an otherwise valid batch. That
song is retried with a delay. After three omissions from the same analysis
recipe it is set aside; a genuinely stronger recipe gets its own fresh
allowance later. Provider failures use the same bounded backoff lane and stop
after three billable attempts instead of leaving a song in an endless retry
loop.

**Canonical results are shared by everyone.** A recording is the same
recording no matter whose library contains it, so Playlistify stores one
accepted AI result against the song itself. The first useful analysis benefits
every later user. This global cache is the product's main cost control.

## Confidence bands

The model reports how sure it is that it recognized the exact recording. That
is a useful quality signal, but it is not measured accuracy, so the Library
calls the column **Confidence**.

| Confidence  | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| **Pending** | No shared analysis has completed yet.                            |
| **None**    | No trustworthy global tags were produced.                        |
| **Low**     | Recognized at 0.40–0.50; AI tags remain informational.           |
| **Medium**  | Recognized at 0.51–0.75; the result can guide playlist matching. |
| **High**    | Recognized at 0.76–1.00; the result can guide playlist matching. |

Values are rounded to two decimal places before any cutoff is applied. A result
below 0.40, or a supposedly recognized result with neither genres nor moods,
becomes None and contributes no AI tags or attributes. Low AI tags stay visible
so a user can understand the result, but they do not drive playlist matching;
personal tags still do.

## When a song is allowed to be re-analyzed

Improving a shared record helps everyone, but accepting every newer answer
would let one uncertain response make the product worse. Playlistify therefore
separates an attempted answer from the canonical answer.

**The system chooses the analysis recipe.** A recipe includes the model plus
the prompt, approved vocabulary, and recording-identification strategy. Users
request an improvement, not a vendor or capability rank. A song is only queued
when an enabled recipe exists whose rank is strictly stronger than every recipe
already attempted for it.

**Only None and Low songs enter the normal recheck path.** Medium and High
songs are left alone. Repeated recheck requests coalesce into the same global
job, and a song remembers a stronger attempt even when the answer was rejected.
That bounds cost to one attempt per genuine recipe step, not one per click or
one per user.

**A candidate is promoted only when it improves the current state.**

- A Pending song may accept a recognized result or an honest None result.
- A None song may accept any trustworthy recognized result.
- A Low song may accept only a Medium or High result.
- A Medium or High song is not replaced by the normal flow.
- An unknown, omitted, failed, invalid, or Low retry cannot erase a usable Low
  result.

Promotion is all-or-nothing: attributes, genres, moods, recognition state, and
the accepted attempt change as one snapshot. Old AI tags are replaced, not
accumulated. If two analyses finish out of order, the decision is rechecked
against the latest shared result before anything changes.

There is deliberately no “redo my whole library” button. Improvement is
song-by-song, limited to weak results, and only when something genuinely
stronger is available. A future decision to revisit Medium or High songs would
be a deliberate operator-run backfill, not a consumer control.

## Personal tags and hidden AI tags

Canonical AI analysis is global, but each person controls how it affects their
own library.

For a user, the effective tags on a song are:

`(Medium/High canonical AI tags - that user's hidden AI tags) + that user's personal tags`

Adding a personal genre or mood changes only that user's experience. Hiding an
AI tag also changes only that user; the shared song is untouched and another
user still sees and searches the canonical tag. Hidden preferences persist
harmlessly if later analysis removes the tag, and apply again if it returns.

If a user personally adds the same tag they hid from the AI, the personal
addition wins. Removing that personal tag does not silently undo the hidden-AI
preference; the user can show the AI tag separately.

This is the immediate recovery path for a None or Low song. A personal tag
makes the song searchable even when AI tags do not. The limitation is that
personal tags do not invent AI attributes: a personally tagged song with no
known energy, era, or tempo still cannot satisfy those filters.

## From a sentence to a playlist

The chat turns “something warm for a rainy Sunday, nothing too sad” into an
actual list of songs from the user's library.

**Free text becomes vetted tags.** The app keeps an approved list of genres and
moods, and enrichment may only use names from that controlled vocabulary.
Off-list model output is dropped rather than silently creating near-duplicates
such as “melancholy,” “melancholic,” and “sad.” Dropped names are counted so
real vocabulary gaps can be reviewed deliberately.

**The assistant sees the user's complete effective vocabulary.** It translates
the request onto every genre and mood that can actually match in that library,
including personal tags and excluding hidden or Low-confidence AI tags. The
same effective-tag rule controls both the vocabulary shown to chat and the song
search beneath it, so the two cannot disagree.

If nothing on the list is close to the request, the assistant says so rather
than quietly substituting something else.

**Multiple criteria narrow rather than widen.** Ask for a genre _and_ a mood
and the result must carry both. Energy, era, tempo, and exclusion conditions
are applied on top.

What comes back is a proposal, not an action. The user sees the tracks first,
can rename the playlist and remove anything unwanted, and only then creates it
in Spotify.

## After a playlist is created

Playlistify keeps the ordered song list that was used to create each playlist.
It can therefore keep managing that playlist after the original chat has gone.

Spotify does not offer a permanent-delete operation for playlists. Deleting a
playlist here unfollows it in Spotify and removes Playlistify's stored copy. A
playlist shown as **Deleted in Spotify** is one that no longer appears among the
user’s Spotify playlists, usually because it was unfollowed in the Spotify
client. While it is missing, title and description edits stay in Playlistify,
and deleting it removes only Playlistify’s stored copy.

While a playlist still exists in Spotify, Spotify is the source of truth for
its title and description. Opening the Playlists page checks Spotify and pulls
changes made in the Spotify client back into Playlistify. Edits made in
Playlistify go to Spotify first, then the matching local display is updated.
The same check picks up Spotify’s generated or custom cover image; because
Spotify’s image links are temporary, Playlistify refreshes the cached link as
part of every check.

Recreate uses the stored song order rather than asking the assistant to make a
new selection. Songs no longer in the user's Liked Songs are skipped, and the
result reports how many of the original songs were restored. A changed title or
description becomes the title or description of the recreated playlist.

A playlist's displayed genres and moods are derived from the effective tags on
its songs. Medium- and High-confidence AI tags count unless that user hid them,
and the user's personal tags count alongside them. These are summaries of the
playlist's songs, not separate labels stored on the playlist itself.
