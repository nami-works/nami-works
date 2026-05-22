# TOV Phase-2 Source Channel Research

Ranked candidate list of additional source adapters for the NAMI Works tone-of-voice extraction product, sized for CPG/D2C beauty-and-consumer-goods merchants. Phase-1 sources (Shopify blog, Meta IG/FB, Monday.com, manual upload/URL) are excluded.

Ranking criterion: **density of voice-bearing copy × API tractability × non-developer onboarding × additive coverage vs. Phase 1**.

## Ranking summary

| # | Source | Vol/brand | S/N | Onboarding | Bring-up tier |
|---|---|---|---|---|---|
| 1 | **Klaviyo** (Email + SMS) | High | High | Low (OAuth) | Phase 2 — week 1 |
| 2 | **WordPress.com + self-hosted WP** (REST API v2) | Med-High | High | Low-Med (App Password / OAuth) | Phase 2 — week 1 |
| 3 | **Mailchimp** (Marketing API) | High | High | Low (OAuth) | Phase 2 — week 2 |
| 4 | **Amazon SP-API** (Listings + A+ Content) | High | High | High (LWA + seller-side ops) | Phase 3 — high-value but heavy |
| 5 | **YouTube Data API v3** | Med | Med | Low (Google OAuth) | Phase 2 — week 2 |
| 6 | **Zendesk Guide** (Help Center articles) | Med | High | Med (OAuth refresh-token by 2026-04-30) | Phase 2 — week 3 |
| 7 | **Gorgias** (macros + ticket replies) | Med-High | Med-High | Low (API key paste) | Phase 2 — week 3 (CPG-shaped) |
| 8 | **Postscript** (SMS campaigns) | Med | High | Low (API key paste) | Phase 2 — week 3 (Shopify-shaped) |
| 9 | **TikTok Organic / Content Posting API** | Med | Med | Med (TikTok dev account) | Phase 3 |
| 10 | **Pinterest API v5** (Pins + Boards) | Low-Med | Med | Low (OAuth) | Phase 3 — beauty-vertical fit |
| 11 | **Webflow CMS API** | Med | High | Low (site API token paste) | Phase 3 |
| 12 | **Ghost Content API** | Low-Med | High | Low (key paste) | Phase 3 — long-tail |
| 13 | **HubSpot CMS Blog + Marketing Email** | Med | High | Med (OAuth v3 / private-app) | Phase 3 — segment-dependent |
| 14 | **Google Drive** (shared folder OAuth) | Variable | Med | Low (Google OAuth, file-picker) | Phase 3 — bridges to "internal docs" |
| 15 | **Podcast RSS** (Apple Podcasts lookup → iTunes Namespace XML) | Low | High (when present) | Low (URL paste / iTunes ID search) | Phase 4 — opportunistic |

## Per-source detail

### 1. Klaviyo (Email + SMS marketing)
- **Source.** Klaviyo email + SMS platform — dominant ESP among Shopify D2C beauty brands. Owns campaign HTML, flow messages, SMS bodies, and template library.
- **Content type.** Campaign HTML (subject + preview + body), template library, flow message bodies, SMS message text. Subject lines + preview text alone are some of the highest-density voice signal a brand produces.
- **Volume per active brand.** **High.** A mid-size beauty brand sends 4-12 campaigns/month + 8-20 active flows × 3-6 messages each. Easily 50-150 unique message bodies of brand copy, refreshed continuously.
- **API path.** `api.klaviyo.com` — Campaigns API (revision `2026-04-15.pre`, GA `2026-07-15`), Templates API, Campaign-Messages, Campaign-Variations. Auth: **OAuth 2.0 with PKCE** (recommended) or private API key. Scopes `templates:read`, `campaigns:read`.
- **Signal-to-noise.** **High.** Campaign copy is the most carefully-crafted brand-voice surface most CPG brands produce — every word fought over by the marketing team.
- **Onboarding complexity.** **Low.** Klaviyo's OAuth app flow is mature; CPG merchants nearly all already use it. We already have a Klaviyo MCP in this environment, indicating production-ready paths.
- **Rec.** **#1 pick for Phase 2.** Highest density × highest signal × already in our merchant overlap. Pairs perfectly with Shopify (already shipped) since most Klaviyo accounts are Shopify-linked.

### 2. WordPress (.com + self-hosted)
- **Source.** WordPress REST API v2 — covers WordPress.com hosted and self-hosted (Jetpack-connected) sites. Many CPG brands keep their blog/editorial site on WP even when storefront is Shopify.
- **Content type.** Posts, pages, custom-post-types, excerpts, category descriptions, author bios.
- **Volume per active brand.** **Medium-High.** Editorial-heavy beauty brands publish 4-20 posts/month, plus ~10-50 evergreen pages. Older brands have years of archive.
- **API path.** REST API v2 at `<site>/wp-json/wp/v2/posts`. Auth: **Application Passwords** (self-hosted, 1-click), or **WordPress.com OAuth2** (`public-api.wordpress.com/oauth2/`) for WP.com + Jetpack.
- **Signal-to-noise.** **High.** Editorial long-form is voice-dense; minimal boilerplate vs. comments/widgets which the API segregates.
- **Onboarding complexity.** **Low-Medium.** WP.com OAuth = click-to-connect. Self-hosted needs the merchant to generate an Application Password (3 clicks in admin). Acceptable for non-devs with a screenshot walkthrough.
- **Rec.** **#2 pick for Phase 2.** Captures the "we blog elsewhere" merchant segment Phase 1 misses. Significant for brands that moved off Shopify Blog after running into its editorial limits.

### 3. Mailchimp
- **Source.** Mailchimp Marketing API v3 — second-largest ESP among non-D2C-native CPG brands and most legacy beauty brands.
- **Content type.** Campaign HTML + plain-text via `/campaigns/{id}/content`, template library, automation emails.
- **Volume per active brand.** **High** (where used) — same shape as Klaviyo.
- **API path.** `https://<dc>.api.mailchimp.com/3.0/`, dc = the data-center suffix on the user's account. Auth: **OAuth 2.0** (recommended for multi-tenant) or API key (single-tenant).
- **Signal-to-noise.** **High.** Same logic as Klaviyo.
- **Onboarding complexity.** **Low.** OAuth click-through. We must capture the dc-prefix from the OAuth response metadata.
- **Rec.** **#3 pick for Phase 2.** Coverage hedge against Klaviyo-only — many GE Beauty-shaped Brazilian brands run Mailchimp or RD Station instead. Ship after Klaviyo as a near-clone adapter.

### 4. Amazon SP-API (Selling Partner API)
- **Source.** Amazon Selling Partner API — Listings Items API + A+ Content Management API. Reaches the "brand registry" segment.
- **Content type.** Product titles, bullet points, descriptions, A+ Content modules (headlines, body copy, image alt-text inside premium content blocks).
- **Volume per active brand.** **High.** A SKU-rich beauty brand on Amazon has 50-500+ listings × 5 voice-bearing text fields, plus dozens of A+ modules. This is significant copy crafted specifically for conversion.
- **API path.** SP-API at `sellingpartnerapi-<region>.amazon.com`. Auth: **Login with Amazon (LWA) OAuth + IAM role assumption**. Requires Amazon developer profile + seller authorization grant.
- **Signal-to-noise.** **High.** Listings copy is voice-heavy, though it's voice-under-constraint (character limits, banned words). A+ Content is closer to free-form brand-voice.
- **Onboarding complexity.** **High.** SP-API onboarding is the worst of any source on this list: developer registration with Amazon, IAM role, LWA app, seller authorization workflow. We will need to absorb a lot of complexity to make this merchant-friendly.
- **Rec.** **#4 — high-value, defer to Phase 3.** Worth doing because Amazon Listings are where GE Beauty-style brands write their most conversion-tested copy, but bring-up cost is high enough that we should validate Phase-2 demand first.

### 5. YouTube Data API v3
- **Source.** YouTube Data API v3 — channel + video metadata for the brand's owned channel.
- **Content type.** Channel `about` description, video titles, video descriptions (full body, often 500-3000 chars on brand channels), tags, playlists.
- **Volume per active brand.** **Medium.** Beauty brands often have 20-200 YouTube videos × rich descriptions. Captions/transcripts are NOT available via official API for non-owned channels but ARE available via the captions endpoint for your own channel — owned-channel captions add another major content slug.
- **API path.** `https://www.googleapis.com/youtube/v3/`. Auth: **Google OAuth 2.0**. Free tier: 10,000 quota units/day — generous for our use case.
- **Signal-to-noise.** **Medium.** Video descriptions are voice-bearing but boilerplated (links, CTAs, sponsor blocks, hashtag walls). We will need a content cleanup pass before Claude inference.
- **Onboarding complexity.** **Low.** Google OAuth, channel selector, done.
- **Rec.** Phase 2 — week 2. Especially valuable for influencer-led beauty brands. Reuse the same Google OAuth surface we'll use for Drive.

### 6. Zendesk Guide (Help Center articles)
- **Source.** Zendesk Help Center API — public KB articles.
- **Content type.** Help center articles, section descriptions, category descriptions. NOT ticket bodies (which are CS-agent voice, not brand voice).
- **Volume per active brand.** **Medium.** A mature CPG brand has 30-200 KB articles × 200-1500 words each.
- **API path.** `https://<subdomain>.zendesk.com/api/v2/help_center/articles.json`. Auth: **OAuth 2.0 with refresh-token grant** (mandatory for third-party apps by 2026-04-30) or API token. Password-based auth removed 2026-01-12.
- **Signal-to-noise.** **High.** KB content is brand-curated, voice-deliberate, and not transactional — strong TOV signal especially for shipping/returns/ingredient pages.
- **Onboarding complexity.** **Medium.** OAuth with refresh-token is well-documented, but the merchant needs to know their subdomain. Token-paste fallback is acceptable.
- **Rec.** Phase 2 — week 3. Add alongside Gorgias (#7) — same content-domain (CS-shaped copy) but different platforms.

### 7. Gorgias (macros + outbound ticket replies)
- **Source.** Gorgias REST API — macros (canned responses) + actual ticket replies from CS agents.
- **Content type.** Macro library (canned-response templates the brand explicitly authored) + outbound public messages on tickets (less curated but still in-voice).
- **Volume per active brand.** **Medium-High.** A typical CPG brand has 30-100 macros × few-hundred-word bodies + thousands of outbound messages.
- **API path.** `https://<subdomain>.gorgias.com/api/`. Auth: **HTTP Basic with email + API key** (paste from settings).
- **Signal-to-noise.** **Medium-High for macros, Medium for replies.** Macros are deliberately voice-trained. Replies drift agent-by-agent but still reflect the brand's CS register.
- **Onboarding complexity.** **Low.** Single-key paste, no OAuth dance.
- **Rec.** Phase 2 — week 3. CPG-vertical-shaped: Gorgias is dominant in Shopify D2C CS. Pulls "register" + "do/don't" hypotheses Phase 1 cannot reach (e.g., refund/shipping tone-of-voice — totally separate register from marketing copy).

### 8. Postscript (SMS marketing — Shopify-shaped)
- **Source.** Postscript API — Shopify-only SMS marketing platform. Direct competitor to Klaviyo SMS, but with much deeper Shopify-D2C penetration than Klaviyo SMS alone.
- **Content type.** SMS campaign bodies, automation messages (welcome, abandoned-cart, post-purchase), keyword auto-replies.
- **Volume per active brand.** **Medium.** 2-8 campaigns/month + 5-15 automations × multi-message sequences. SMS is short-form-dense — high voice-per-character.
- **API path.** `https://api.postscript.io/api/v2/`. Auth: API key (paste from settings).
- **Signal-to-noise.** **High.** SMS forces brutal voice clarity — every word weighted.
- **Onboarding complexity.** **Low.** Key-paste.
- **Rec.** Phase 2 — week 3 alongside Klaviyo if the merchant uses both. Otherwise Phase 3.

### 9. TikTok Organic / Content Posting API
- **Source.** TikTok for Business — Content Posting API (organic posts) + Display API (read posts).
- **Content type.** Video captions + descriptions of brand's owned TikTok channel.
- **Volume per active brand.** **Medium** for active brands, near-zero for non-TikTok-native brands. Captions are short but voice-saturated.
- **API path.** `open.tiktokapis.com`. Auth: **TikTok OAuth** (requires TikTok Developer account approval — slower than Google OAuth).
- **Signal-to-noise.** **Medium.** Captions are voice-dense but riddled with hashtags + trend-driven phrasing that may pollute the brand voice extraction. Strip hashtags before inference.
- **Onboarding complexity.** **Medium.** Developer-account approval has historically been variable in latency. Acceptable for non-devs but support overhead is higher.
- **Rec.** Phase 3. Important for influencer/beauty-vertical brands; can wait until we have a few merchants demanding it.

### 10. Pinterest API v5
- **Source.** Pinterest REST API v5 — pins + boards on the brand's Business account.
- **Content type.** Pin titles + descriptions, board titles + descriptions.
- **Volume per active brand.** **Low-Medium.** Beauty brands often use Pinterest heavily (visual-led category fit), but pin descriptions are short — a few sentences each.
- **API path.** `https://api.pinterest.com/v5/`. Auth: **OAuth 2.0** with `pins:read`, `boards:read`.
- **Signal-to-noise.** **Medium.** Pin captions skew SEO-loaded and template-formulated.
- **Onboarding complexity.** **Low.** Pinterest OAuth is straightforward.
- **Rec.** Phase 3. Strong CPG/beauty-vertical fit but voice-density too low to outrank emails/blog.

### 11. Webflow CMS API
- **Source.** Webflow CMS API — for brands whose marketing site is on Webflow (significant segment of Shopify D2C — common headless pairing).
- **Content type.** CMS collection items (blog posts, lookbook entries, product narratives, FAQ entries) + static page rich-text.
- **Volume per active brand.** **Medium.** Equivalent to a Wordpress or Ghost surface for those who use it.
- **API path.** `https://api.webflow.com/v2/`. Auth: **Site API token** (paste from Project Settings → Integrations → API Access) or OAuth for multi-tenant apps. Tokens expire after 365 days inactivity.
- **Signal-to-noise.** **High.** Marketing-site content is curated. Less editorial volume than WP for the same merchant size.
- **Onboarding complexity.** **Low.** Token-paste.
- **Rec.** Phase 3 — addresses the "site-not-on-Shopify" segment alongside WordPress.

### 12. Ghost Content API
- **Source.** Ghost (open-source publishing platform) — Content API.
- **Content type.** Posts, pages, tags, authors.
- **Volume per active brand.** **Low-Medium.** Ghost has small share among CPG brands; meaningful only if a specific merchant is on it.
- **API path.** `<site>/ghost/api/content/`. Auth: **Content API Key** (query-param). Read-only.
- **Signal-to-noise.** **High** (editorial platform).
- **Onboarding complexity.** **Low.** Generate integration in Ghost Admin → paste URL + key.
- **Rec.** Phase 3 long-tail. Ship as a "completist" lightweight adapter alongside WP/Webflow.

### 13. HubSpot CMS Blog + Marketing Email
- **Source.** HubSpot CMS Blog API + Marketing Email API.
- **Content type.** Blog posts (draft + live versions) + marketing email HTML.
- **Volume per active brand.** **Medium.** Skewed B2B but some D2C beauty brands run HubSpot for the full marketing stack.
- **API path.** `/cms/blogs/2026-03/posts/{postId}` + Marketing Email endpoints under the same date-versioned namespace. Auth: **OAuth v3** (`/oauth/2026-03/token`). OAuth v1 deprecated — must use v3 endpoints for all new apps.
- **Signal-to-noise.** **High.** HubSpot content tends to be carefully voiced when used.
- **Onboarding complexity.** **Medium.** OAuth v3 well-documented. Private-app option exists for single-portal.
- **Rec.** Phase 3 — segment-dependent. Lower priority for CPG specifically than the ESP triad (Klaviyo + Mailchimp + Postscript).

### 14. Google Drive (shared folder OAuth)
- **Source.** Google Drive API v3 — shared folder content via `drive.file` scope (file-picker controlled) or `drive.readonly` (broader).
- **Content type.** Whatever the merchant chose to share — brand books, voice guidelines, internal pitches, deck copy, ad-asset directories. Often gold for "internal canon" docs that never reach external channels.
- **Volume per active brand.** **Variable.** When present, can be a single brand-book PDF + several decks. When absent, zero.
- **API path.** `https://www.googleapis.com/drive/v3/`. Auth: **Google OAuth** with the `drive.file` scope plus Google's Picker for file selection — secure, narrow, and user-confidence-friendly.
- **Signal-to-noise.** **Medium-High** when populated with brand-book material; Low when populated with random ops files.
- **Onboarding complexity.** **Low.** Google Picker is the gold-standard "non-dev merchant" surface.
- **Rec.** Phase 3. Re-skin our existing manual-upload path: instead of "upload a PDF," let the user pick directly from Drive. Reuses the Google OAuth scope we'd also use for YouTube (one Google consent screen → two adapters).

### 15. Podcast RSS (Apple iTunes Lookup → iTunes Namespace XML)
- **Source.** Brand-owned podcast RSS feed, discovered via Apple's iTunes Lookup API (no auth) or pasted by merchant.
- **Content type.** Episode titles, episode descriptions / show notes — frequently several paragraphs each, deliberately voiced.
- **Volume per active brand.** **Low.** Few CPG brands own a podcast, but those who do tend to invest heavily in voice consistency (think audio-led D2C).
- **API path.** Apple iTunes Lookup API at `https://itunes.apple.com/lookup?id=<itunesId>` returns RSS URL. RSS parsing via standard XML/iTunes-Namespace parser.
- **Signal-to-noise.** **High** when present.
- **Onboarding complexity.** **Low.** Search by show name → paste iTunes ID or RSS URL.
- **Rec.** Phase 4 opportunistic. Build only if a CPG cohort asks (e.g., a podcast-led beauty brand).

## Cross-cutting observations

- **The Klaviyo + Postscript + Gorgias triad covers the three under-served registers** (marketing-promo, SMS-urgent, CS-supportive) that brand voice spec callers most often need but Phase 1 never reaches. All three are CPG/Shopify-native — fast, high-leverage, low-onboarding.
- **One Google OAuth screen unlocks two sources** (YouTube + Drive). Bundle them into a single "Connect Google" step in the UX.
- **Auth-tier reality**: SP-API and LinkedIn require partner approval / restricted access. Klaviyo, Mailchimp, Postscript, Gorgias, Webflow, Ghost, Pinterest, WP, Notion, Zendesk, HubSpot are all token-paste-or-OAuth and well within "non-dev merchant" range.
- **Surprise — Substack is essentially closed.** No official public API; only unofficial Python wrappers + third-party paid scrapers. If a merchant runs a Substack newsletter for their brand voice, the cleanest path is to ask them to paste the public RSS URL into our existing manual-URL adapter rather than write a dedicated Substack adapter.
- **Surprise — Twitter/X has economically degraded out of scope.** Post-Feb-2026 pricing made even Basic ($200/mo) untenable for our adapter to subsidize, and pay-per-use ($0.005-$0.20 per request) breaks the merchant's free-tier expectation. Recommend skipping unless the merchant supplies their own X API account.
- **Surprise — LinkedIn Company Pages require Marketing API Partner status** (restricted product, application + approval). This effectively gates LinkedIn for non-enterprise plays. Document as "out of reach for Phase 2/3" rather than ranking it.
- **Surprise — Zendesk's January 2026 password-auth deprecation** combined with the April 2026 mandatory OAuth-refresh-token migration means any Zendesk adapter we ship MUST use the refresh-token flow from day one. Don't build the easier API-token-only path — it'll be deprecated before we onboard customers.
