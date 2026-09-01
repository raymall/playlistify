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

**Analysis runs in batches** because one request for a couple of dozen songs is
faster and cheaper than that many separate requests. How many go into one
request is part of the recipe, not a setting — see below. The app keeps
starting batches until the eligible part of the library is done or the run
reaches its spending cap. It is resumable: closing the page or pausing after a
batch does not discard completed work.

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
after three tries instead of leaving a song in an endless retry loop.

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
so a user can understand the result, and they can still be searched and
filtered in the Library, but they do not drive playlist matching; personal tags
still do.

## When a song is allowed to be re-analyzed

Improving a shared record helps everyone, but accepting every newer answer
would let one uncertain response make the product worse. Playlistify therefore
separates an attempted answer from the canonical answer.

**The system chooses the analysis recipe.** A recipe is the complete method
used to analyze a song, not just the model that answered: the model, the
instructions it was given, the vocabulary it was allowed to choose from, how
hard it was asked to think, how many songs it weighed in one go, and how the
recording was described to it. Change any one of those and it is a different
recipe, because the answer may change with it.

Recipes are never edited. A change mints a new one, so a record of what has
already been tried on a song stays true instead of quietly coming to mean
something else. That is enforced rather than remembered: a recipe carries
every one of those parts verbatim — the instructions, the allowed vocabulary,
the way a recording is described — and a fingerprint of the whole method is
its identity, so an altered method cannot be filed as the old one.

One consequence is deliberate: the vocabulary is frozen into the recipe when
it is minted. Approving a new genre or mood changes nothing about the analyses
being run until a new recipe is minted carrying the updated list — which also
means two runs of one recipe always chose from exactly the same words.

Each recipe carries a rank — its place on a ladder from
cheapest to strongest — and that rank is what decides when a song has earned
another look. Users request an improvement, not a vendor or a capability rank.

**Every song gets three tries at its current quality level.** The model is not
deterministic, so a second ask at the same level is a real chance at a better
answer rather than a replay. After the third answer the song is **locked** and
waits. Only answers count against the three: a batch that skipped the song, or
a provider failure, has its own separate allowance and does not spend a try.

**A locked song unlocks by itself when something better arrives.** The budget
is counted per quality level, so enabling a stronger recipe gives every locked
song a fresh three tries at the new level — no one has to go and reset
anything.

**Pending, None, Low, and Medium songs may be re-analyzed. High songs are left
alone.** A Medium song is included because it can still be wrong, but the bar
for replacing it is high: only a High result may take its place.

**A recipe may opt in to revisiting High songs.** This is the one exception,
and it belongs to the recipe rather than to anyone using the app. A recipe can
declare that it is worth re-examining even the songs that already look
settled — and if it does, it still has to outrank whatever produced the
existing result, and its answer still has to come back High. A weaker answer
from a stronger recipe changes nothing. Turning that on is an operator
decision, taken once for a recipe, not a button anyone can press per song.

**There is one way in: Enrich.** One button works through everything
eligible, and there is no per-song request. Nothing is analyzed in the
background either — the library waits until you ask. The reason it is a single
control is that the recipe already decides what is worth analyzing; a per-song
button could only ask for the same work in a different order, while making it
look like some songs could be pushed harder than others.

**The Library shows the recipe it is using.** Beside the button it names the
current recipe in full — model, effort, batch size, rank, and a short
fingerprint of the frozen method — and, if a stronger recipe would take some
songs on the next run, how many. Each song's
tag panel names the recipe behind its own result, which is how a row analyzed
under an older vocabulary is distinguishable from one analyzed under today's.

**A candidate is promoted only when it improves the current state.**

- A Pending song may accept a recognized result or an honest None result.
- A None song may accept any trustworthy recognized result.
- A Low song may accept only a Medium or High result.
- A Medium song may accept only a High result.
- A High song is replaced only by a High result from a stronger recipe that
  opted in, and never by anything below High.
- An unknown, omitted, failed, invalid, or weaker retry cannot erase a usable
  result.

The rule underneath all of those is one sentence: **a new answer has to land in
a better band than the current one.** A more confident answer inside the same
band is not an improvement — accepting those would slowly drag every band's
lower edge upward without any song actually being better understood.

Promotion is all-or-nothing: attributes, genres, moods, recognition state, and
the accepted attempt change as one snapshot. Old AI tags are replaced, not
accumulated. If two analyses finish out of order, the decision is rechecked
against the latest shared result before anything changes.

Improvement is still capped, but **Enrich** covers every song below
High, Medium included — so one click can re-analyze songs that already have a
usable result. What keeps that honest is the promotion rule above: a Medium
song that gets three more Medium answers stays exactly as it was, having cost
three answers and changed nothing. Revisiting **High** songs is a deliberate
backfill rather than a consumer control, which is why it lives on the recipe:
someone decides once that a particular recipe earns that reach, and the
promotion rule still has the last word on every individual song.

## Personal tags and hidden AI tags

Canonical AI analysis is global, but each person controls how it affects their
own library.

For playlist building, the effective tags on a song are:

`(Medium/High canonical AI tags - that user's hidden AI tags) + that user's personal tags`

The Medium/High bar applies only to the AI half. A user's own tags always
count, on any song in their library, whatever its Confidence band — a personal
tag on a Pending, None, or Low song is as good for building a playlist as a
High-confidence AI tag. That is what makes personal tagging a real fix and not
just a note to self.

Browsing the Library uses a deliberately wider rule, described under _Finding
songs in the library_ below.

**Personal tags are free-form.** Whatever a user types is what gets saved — no
approved list, no suggestion they are obliged to pick from, and no quiet
correction onto a similar-looking tag that already exists. Typing “regaeton”
saves “regaeton,” not “reggaeton.” The only thing the app does to the text is
lowercase it and tidy the spacing — trimming the ends and collapsing doubled
spaces — so the same tag typed twice is one tag rather than two.
The typeahead in the tag editor is there to save keystrokes and to help people
converge on names they already use; ignoring it entirely is a supported way to
tag. This is the exact opposite of the rule enrichment follows, and
deliberately so: the AI may only use vetted names because its output is shared
with everyone, while a personal tag is one person's own word for their own
song.

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

## Finding songs in the library

The Library lists a user's songs newest-liked first, a page at a time. One
search box does both jobs: typed words search titles and artists, and choosing
a suggested genre or mood adds it as a filter pill.

**Everything narrows.** Several typed words must all match the same song's
title or artist, not merely one of them. Several pills must all be on the song.
Text and pills apply together and only ever narrow. The one exception is the
Confidence filter: a song sits in exactly one band, so picking several bands
reads as a choice between them — they widen against each other while still
narrowing against text and tags.

**Suggestions come from the user's own library**, so a genre that would return
nothing is never offered, and each suggestion carries the number of songs
behind it. Very short fragments are ignored, because a one- or two-letter run
matches almost everything.

**What a user can see, a user can filter by.** Display deliberately ignores the
Confidence band. For finding songs, the tags on a song are:

`(all canonical AI tags - that user's hidden AI tags) + that user's personal tags`

with no confidence floor — so a Low-confidence AI tag, or a personal tag on an
unrecognized song, still finds its row. Playlist building uses the stricter
Medium/High rule described above.

The divergence is deliberate, not an oversight: a chip visible on a row must
find that row when it is clicked, while a weak tag must still never quietly
shape a playlist.

## From a sentence to a playlist

The chat turns “something warm for a rainy Sunday, nothing too sad” into an
actual list of songs from the user's library.

**An empty conversation offers starting points.** Three prompt ideas are drawn
from tags that genuinely exist in that user's library, so every suggestion is
one the assistant can actually satisfy. They stay put for the life of a browser
tab rather than reshuffling on every visit.

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
and the result must carry both. Energy, era, and exclusion conditions are
applied on top; tempo is shown with each candidate for the assistant to weigh
when hand-picking, not applied as a filter.

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
new selection. Songs no longer in the user's library are skipped — the library
only drops a song after a completed re-sync confirms the unlike — and the
result reports how many of the original songs were restored. A changed title or
description becomes the title or description of the recreated playlist.

A playlist's displayed genres and moods are derived from the effective tags on
its songs. Medium- and High-confidence AI tags count unless that user hid them,
and the user's personal tags count alongside them. These are summaries of the
playlist's songs, not separate labels stored on the playlist itself.
