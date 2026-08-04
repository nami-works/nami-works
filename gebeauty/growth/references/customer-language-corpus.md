# The customer-language corpus

**Source:** Limited Supply / Nik Sharma, podcast transcript on AI landing pages
(digested 2026-07-31). **Provenance:** external best-practice, not our measured data.
**Why it's here:** it turns "write copy grounded in customer language" from an aspiration
into a build with a concrete input list, and it is the one playbook-grade chunk in that
source.

## The claim

The highest-leverage input to page copy is not a better prompt. It is a standing corpus of
**the words customers actually use**, aggregated across every channel where they use them,
plus **behavioural evidence of what already works on the page.** Assembled once, that corpus
gives a writing agent more usable context than any individual could hold, because the
alternative is a person reading every review, ticket and comment by hand and they will not.

The corpus is not a research artifact produced once and filed. It is a live input that feeds
briefs, angle selection, page copy and objection handling on every build.

## What goes in

Two distinct classes. Both matter, and teams usually build only the first.

### Class 1 — voice: how customers describe the problem and the result

| source | what it uniquely gives |
|---|---|
| product reviews | post-purchase language, the benefit as *they* phrase it, and the specific disappointments |
| support tickets / CS history | the pre-purchase confusion and the objections that actually block a sale |
| email and SMS replies | unprompted reactions, often blunter than a review |
| social comments on organic posts | the question asked in public, and the peer answer |
| paid-ad comments | objection at the coldest possible moment, before any site visit |
| marketplace reviews | the same product judged without your brand framing around it |
| public forum and social mentions | how people describe the problem when *not* talking to you, which is where the real search language lives |

The last row is the one most often skipped and it is the most valuable for cold traffic,
because it is the only source uncontaminated by your own vocabulary.

### Class 2 — behaviour: what already works on the page

| source | what it uniquely gives |
|---|---|
| heatmap / scroll / click data | which sections earn attention, where the page dies |
| on-page element performance | hero style vs lifestyle vs UGC, copy variants, button treatments |
| ad-level creative results | which headlines and hooks earned the click, which never did |
| customer profile / order data | who actually buys, so the copy addresses the buyer and not an imagined persona |

Class 2 is what stops the corpus from producing well-phrased copy in a layout that has
already been shown not to convert.

## How to build it

1. **Pick the aggregation point.** Anything that can hold context and be queried: an agent
   with tool access, a vector store, or in the simplest useful version a set of exported
   text files in one directory. The sophistication of the store matters far less than the
   completeness of the inputs.
2. **Connect by API, not by export.** Manual exports rot immediately and silently. Where a
   source has no API, schedule the export and record the extraction date on the artifact so
   staleness is visible.
3. **Normalize to one shape.** Each record: source, date, verbatim text, and any structured
   fields worth filtering on (product, rating, resolution, sentiment). Keep the verbatim
   text intact. **Never let a summarization pass overwrite the original wording** — the
   wording is the entire asset, and a paraphrase silently launders it into your own voice.
4. **Separate voice from behaviour** in storage. They answer different questions and mixing
   them makes both harder to query.
5. **Strip PII on the way in**, not on the way out. Names, emails, phone numbers, order
   identifiers and addresses have no analytical value here and their presence blocks you
   from committing or sharing the corpus.
6. **Date everything.** A two-year-old objection about a formula you reformulated is
   actively misleading. Filter by recency for copy work; keep the history for trend work.
7. **Re-run on a cadence** tied to how fast the catalogue and the offers move.

## How to use it

- **Angle selection.** Rank candidate angles by how often the underlying problem appears in
  customer language, not by which one the team likes. Frequency in the corpus is the closest
  cheap proxy for market size of a pain.
- **Copy.** Write the headline and the body from phrasings that already appear in the
  corpus. Where an exact phrase recurs across independent sources, it is a strong candidate
  for a headline.
- **Objection handling.** The support-ticket and ad-comment slices are a ready-made objection
  list, ranked by volume. This pairs directly with the objection-page taxonomy in
  `knowledge.md`.
- **FAQ.** Use real questions verbatim. A question lifted from a comment thread outperforms
  an invented one because it was demonstrably worth typing.
- **Proof.** Real quotes, attributed, beat written testimonial copy. Confirm the publication
  permission separately from the analytical use.
- **Layout.** Let the behavioural slice decide section order and which module carries the
  argument, rather than a house template applied uniformly.

## Failure modes

- **Summarizing the corpus into themes and then writing from the themes.** This throws away
  the exact wording, which was the only thing the corpus had that a competent writer did not.
- **Building Class 1 only.** You get authentic copy in an unproven layout.
- **Treating volume as truth.** The loudest objection is not always the one blocking the most
  revenue; a low-frequency objection at the checkout step can outweigh a high-frequency one
  at the awareness step. Weight by funnel position.
- **Letting it go stale silently.** Without an as-of date on every record, an old corpus is
  indistinguishable from a current one and will confidently produce obsolete claims.
- **Assuming the corpus licenses the claim.** A customer saying a product cured something is
  evidence of language, not evidence of efficacy. Claim rules still bind.
