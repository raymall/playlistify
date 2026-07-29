# How Playlistify works

Plain-language explanation of what the product does and why it decides what it
decides. No setup instructions, no file paths — `ARCHITECTURE.md` is the map of
the code, `MVP-PLAN.md` is the product spec, and this file is the reasoning.

## Enrichment

Spotify tells us a song's title, artist, album and release date. It does not
tell us what the song _feels_ like, and the endpoints that used to hint at that
were closed to new apps. So the app asks a language model instead.

**Enriching a song** means asking a model what it knows about that specific
recording, and getting back a small, fixed set of facts: which genres it
belongs to, which moods it evokes, how energetic it is, whether it feels slow
or fast, roughly what era it comes from, what instruments stand out, and a few
free-form descriptors. Those answers are what the chat later searches over. An
un-enriched song is effectively invisible to playlist building.

**It runs in batches** — about twenty songs per request — for two reasons.
Asking about twenty songs in one request is far cheaper and faster than twenty
separate requests, and a batch is small enough to finish well inside a request
timeout. The app keeps firing batches until the library is done, and each batch
saves its results before the next one starts. That means enrichment is
resumable: close the tab halfway through and nothing is lost, because the songs
already written are already written.

**Sometimes a song just doesn't come back.** Ask about twenty songs and the
model occasionally answers about nineteen, silently dropping one. That song
hasn't failed and hasn't been recognized — nothing happened to it at all, so it
stays first in line for the next batch. Left alone, one stubborn song would be
re-sent forever, costing a little money every time and never producing an
answer. So the app keeps count: after three misses in a row it sets that song
aside and stops asking. Any answer at all resets the count, so a one-off drop
costs a song nothing — it takes a pattern. Choosing a stronger model brings it
back into the queue with a clean slate too, because a better model is a
genuinely new question rather than the same one repeated.

**The results are shared by everyone.** Enrichment is stored against the song
itself, keyed by its Spotify track id — not against the person who happened to
trigger it. "Bohemian Rhapsody" is the same recording no matter whose library
it sits in, so the answer only has to be bought once. The first user to enrich
a song pays for it; everyone who likes that song afterwards gets the result for
free. This is the single biggest cost decision in the product, and it is why an
already-enriched song is normally left alone: re-asking would spend money to
buy an answer we already own.

## Confidence, and the Accuracy column

The model reports how sure it is that it recognized the exact recording, and
that number is the whole quality signal.

**Below the cutoff, a song gets no tags at all.** If the model isn't
sufficiently sure, the app records the song as unrecognized and writes nothing
— no genres, no moods, no attributes. This is deliberate. A model that half-
remembers a song will happily invent plausible-sounding tags, and wrong tags
are worse than missing ones: they don't just fail to help, they actively
poison playlists by matching requests they have nothing to do with. The same
rule catches a second case — an answer that comes back confident but with no
genres and no moods, which is the model's way of shrugging. That counts as
unrecognized too.

**Confidence is kept to two decimal places**, so although it looks like a
number between 0 and 1, it is really a 0–100 scale in disguise: the only values
that can be stored are 0, 1, 2 … 100 out of 100. That is what lets the bands
below be stated as exact ranges with nothing able to fall between them.

The library table shows one **Accuracy** column with five readings:

| Accuracy    | What it means                                                  |
| ----------- | -------------------------------------------------------------- |
| **Pending** | Not analyzed yet.                                              |
| **None**    | The model didn't recognize the recording, so it wrote no tags. |
| **Low**     | Barely recognized — 50 out of 100 or below.                    |
| **Medium**  | Recognized with reasonable confidence — 51 to 75.              |
| **High**    | Confidently recognized — 76 or above.                          |

Pending and None aren't confidence scores at all; they're states. Only
recognized songs get a score.

One consequence is worth knowing. Because anything under 40 is thrown out as
unrecognized, a song that survives to be scored Low is really sitting somewhere
in the 40–50 range. In practice **Low means "barely recognized"**, not "badly
recognized" — anything weaker than that already became None. That is the cutoff
working as intended, not a gap in the scale.

## When a song is allowed to be re-analyzed

Enrichment improves the shared record for everyone, which is exactly why it
can't be allowed to run backwards. Three rules keep it one-way.

**Finished songs are left alone.** Medium and High are done. Nothing re-asks
about them, ever.

**Only None and Low can be redone.** These are the songs where the app's answer
is either "I don't know" or "I barely know", so there is real headroom. They
stay permanently eligible rather than being written off — a song the app
couldn't place today is a song a better model might place later.

**Being eligible is not the same as being redone.** Every song remembers _how
capable_ the model that analyzed it was, and a re-analysis only happens when
you pick a model that is genuinely better than that one. Same model, or a
weaker one, and the app declines before spending anything. Two models that
can't be meaningfully compared — different vendors, no evidence either way —
count as equal, so they decline too. Refusing is the safe answer: no downgrade,
no wasted money.

Together these mean the library only ever improves, and never pays twice for
the same answer. It also means the cost is bounded: a song can be re-analyzed
once per genuine step up in model capability, not once per attempt and not once
per user. And because the record is shared, the first person to upgrade a song
upgrades it for everybody.

**There is deliberately no "redo my whole library" button.** A sweep like that
would cost more every month, because its price scales with the entire
collection rather than with the part that needs help — and most of what it
re-bought would be answers the app already owns. Improvement is meant to arrive
the other way round: song by song, only where the current answer is weak, and
only when something genuinely better is available to ask. If a future model
ever proves clearly better on songs already scored Medium or High, that would be
a deliberate one-off backfill run by an operator, not a button in the app.

This is why the enrichment panel sometimes says a model has nothing left to do.
It isn't that the library is finished — it's that the model you picked isn't
better than the one that already tried, or that the songs still waiting are ones
it has already been asked about and repeatedly failed to answer.

## From a sentence to a playlist

The chat turns "something warm for a rainy Sunday, nothing too sad" into an
actual list of songs from your library.

**Free text becomes vetted tags.** The app keeps an approved list of genres and
moods — a controlled vocabulary — and the assistant may only search using names
from it. When the model asks for a tag that isn't on the list, that tag is
**dropped rather than invented**. Nothing is auto-created behind your back.
This matters because the vocabulary is what makes search work at all: if every
request could mint new tags, "melancholy", "melancholic" and "sad" would become
three unrelated buckets and nothing would ever match. Dropped names are still
counted, so genuine gaps in the approved list can be spotted and filled
deliberately.

**The assistant is shown the whole list, and translates onto it.** Before it
searches anything, the assistant is handed every genre and mood that actually
appears in _your_ library — the complete set, never a sample — including the
tags you added yourself. Its job is then to map your wording onto that list:
ask for something "melancholic" and it looks for the closest thing you own,
which is `sad`. This is why the list has to be complete. A tag the assistant
isn't shown may as well not exist, however many of your songs carry it.

If nothing on the list is close to what you asked for, it tells you so rather
than quietly substituting something else.

**Your own tags count as much as the AI's.** Every song has two independent
sets of labels: what the model inferred, and what you added yourself. Personal
tags are private to you and never become part of the shared record. When the
chat searches for a genre or mood, it looks in **both** — a song matches if
either the AI or you labelled it that way. So correcting or supplementing the
AI directly improves the playlists you get.

This holds even for songs the AI never recognized. A song sitting at **None**
has no tags of its own, so normally there is nothing to match on and it is
skipped — but the moment you tag it yourself, it becomes eligible like any
other. Your label is real information, and the app treats it that way. The one
limit is that such a song still has no energy, era or tempo, since only the AI
supplies those; ask for "high energy salsa" and a song you tagged `salsa` by
hand won't qualify, because nothing knows how energetic it is.

**Multiple criteria narrow rather than widen.** Ask for a genre _and_ a mood
and you get songs carrying both, not songs carrying either. Attribute
conditions — energy level, era, things to exclude — are applied on top of that.

What comes back is a proposal, not an action. You see the tracks first, can
rename the playlist, drop anything you don't want, and only then does anything
get created in your Spotify account.
