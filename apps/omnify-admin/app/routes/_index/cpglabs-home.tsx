import { useMemo, useState } from "react";
import { Form, useActionData, useNavigation } from "react-router";

import { CpgLabsNav, CpgLabsFooter } from "../../components/cpglabs-layout";

import styles from "./cpglabs-home.module.css";

// PLACEHOLDER Calendly link. /growth-hacker will replace this once the event exists.
const CALENDLY_URL = "https://calendly.com/cpg-labs/fit-call";

type ActionResult =
  | { ok?: boolean; error?: string; success?: boolean }
  | undefined;

type FormErrors = {
  store_url?: string;
  pain?: string;
  workaround?: string;
  timeline?: string;
  email?: string;
};

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Describe the pain",
    body: "Five fields. No sales call.",
  },
  {
    step: "02",
    title: "Get a scoped quote",
    body: "Written scope, fixed setup fee, monthly hosting, in 48 hours.",
  },
  {
    step: "03",
    title: "Ship in days",
    body: "Built as an embedded app. Test on your store before you pay.",
  },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Is this actually reliable, or is it a two-hour hack?",
    a: "Every build runs on AWS with logging, error alerts, and database backups, the same setup we would use for a production app. The two-hour number is how fast AI-assisted development lets us ship the first working version. It's reviewed, tested on your store, and monitored after launch.",
  },
  {
    q: "Who owns the code if I stop paying?",
    a: "You own your data forever, exported on request in standard formats. The code itself stays with us so we can maintain it across merchants, but we will never hold your store hostage. If you cancel, the service turns off cleanly and your Shopify admin goes back to exactly how it was.",
  },
  {
    q: "Will this lock me into your platform?",
    a: "The app is a standard Shopify embedded app. Uninstalling it removes it from your admin the same way any app does. We do not modify your theme files, your product data, or your checkout. Whatever we build sits alongside Shopify, not on top of it.",
  },
  {
    q: "What about maintenance when Shopify changes their API?",
    a: "Hosting covers that. When Shopify deprecates an API version or ships a breaking change, we update your service before it breaks. You do not get a support ticket, you get a note that we already fixed it.",
  },
  {
    q: "How fast can you actually ship?",
    a: "Most single-feature builds are scoped within 48 hours and shipped within 5 to 10 business days. Bigger builds take longer and we will tell you that in the scope. If we cannot ship something in a reasonable window, we say no instead of dragging it out.",
  },
];

const TIMELINE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "asap", label: "ASAP, it's breaking something now" },
  { value: "this_month", label: "This month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "exploring", label: "Just exploring for now" },
];

const LTV_STEPS = [
  { label: "Build 1", note: "auto-tagger" },
  { label: "+ Build 2", note: "inventory sync" },
  { label: "+ Build 3", note: "custom report" },
];

// ── Inline validation helpers (mirror the server-side rules) ──

function validateStoreUrl(value: string): string | undefined {
  if (!value) return "Add your store URL so we can look it up.";
  if (!/^https?:\/\//i.test(value)) {
    return "Start the URL with https:// so the link works.";
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.includes(".")) {
      return "Use a full domain, like https://yourstore.myshopify.com.";
    }
  } catch {
    return "That URL doesn't look right, double-check it.";
  }
  return undefined;
}

function validatePain(value: string): string | undefined {
  if (!value) return "Tell us what's broken in a sentence or two.";
  if (value.length < 20) return "Give us a little more detail, one or two sentences.";
  if (value.length > 1000) return "Trim it down to around 1000 characters.";
  return undefined;
}

function validateWorkaround(value: string): string | undefined {
  if (value && value.length > 500) return "Trim it to around 500 characters.";
  return undefined;
}

function validateTimeline(value: string): string | undefined {
  const ok = TIMELINE_OPTIONS.some((o) => o.value === value);
  if (!ok) return "Pick a timeline so we can plan the scope.";
  return undefined;
}

function validateEmail(value: string): string | undefined {
  if (!value) return "Add an email so we can reply.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "We need an email with an @ so we can reply.";
  }
  return undefined;
}

// ── Hero cost-stack SVG (inline, LCP-friendly) ──

function HeroCostStack() {
  // 6 stacked rows of competing apps + 1 CPG Labs row with gradient.
  // Width 420, height 380. Scales via CSS.
  const apps = [
    { name: "InventoryPro", price: 29 },
    { name: "PriceRules+", price: 39 },
    { name: "BulkTag", price: 19 },
    { name: "ReorderBot", price: 29 },
    { name: "WholesaleGate", price: 29 },
    { name: "CustomReports", price: 29 },
  ];
  const rowHeight = 40;
  const rowGap = 8;
  const startY = 16;
  const rowWidth = 380;
  const rowX = 20;

  return (
    <svg
      className={styles.heroSvg}
      viewBox="0 0 420 380"
      role="img"
      aria-label="Stacked Shopify app subscriptions next to one CPG Labs app"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cpgLabsRowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5ecece" />
          <stop offset="45%" stopColor="#b09fda" />
          <stop offset="75%" stopColor="#d4a8d4" />
          <stop offset="100%" stopColor="#5ecece" />
        </linearGradient>
      </defs>

      {apps.map((app, i) => {
        const y = startY + i * (rowHeight + rowGap);
        return (
          <g key={app.name}>
            <rect
              x={rowX}
              y={y}
              width={rowWidth}
              height={rowHeight}
              rx={8}
              ry={8}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
            <text
              x={rowX + 16}
              y={y + rowHeight / 2 + 5}
              fontSize={14}
              fontFamily="var(--site-font)"
              fill="currentColor"
              fillOpacity={0.7}
            >
              {app.name}
            </text>
            <text
              x={rowX + rowWidth - 16}
              y={y + rowHeight / 2 + 5}
              fontSize={14}
              fontFamily="var(--site-font)"
              fill="currentColor"
              fillOpacity={0.7}
              textAnchor="end"
              textDecoration="line-through"
            >
              ${app.price}/mo
            </text>
          </g>
        );
      })}

      {/* Separator + total line */}
      <text
        x={rowX + rowWidth - 16}
        y={startY + 6 * (rowHeight + rowGap) + 18}
        fontSize={12}
        fontFamily="var(--site-font)"
        fill="currentColor"
        fillOpacity={0.55}
        textAnchor="end"
      >
        $174/mo, half-used
      </text>

      {/* CPG Labs row (highlighted, gradient) */}
      <rect
        x={rowX}
        y={startY + 6 * (rowHeight + rowGap) + 32}
        width={rowWidth}
        height={rowHeight + 8}
        rx={10}
        ry={10}
        fill="url(#cpgLabsRowGradient)"
      />
      <text
        x={rowX + 16}
        y={startY + 6 * (rowHeight + rowGap) + 32 + (rowHeight + 8) / 2 + 5}
        fontSize={15}
        fontFamily="var(--site-font)"
        fontWeight={700}
        fill="#1d1d1f"
      >
        CPG Labs
      </text>
      <text
        x={rowX + rowWidth - 16}
        y={startY + 6 * (rowHeight + rowGap) + 32 + (rowHeight + 8) / 2 + 5}
        fontSize={14}
        fontFamily="var(--site-font)"
        fontWeight={700}
        fill="#1d1d1f"
        textAnchor="end"
      >
        $300 to $500 setup
      </text>
    </svg>
  );
}

export function CpgLabsHome() {
  const actionData = useActionData() as ActionResult;
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "lead";

  const [formValues, setFormValues] = useState({
    store_url: "",
    pain: "",
    workaround: "",
    timeline: "",
    email: "",
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const errors: FormErrors = useMemo(() => {
    return {
      store_url: touched.store_url ? validateStoreUrl(formValues.store_url) : undefined,
      pain: touched.pain ? validatePain(formValues.pain) : undefined,
      workaround: touched.workaround ? validateWorkaround(formValues.workaround) : undefined,
      timeline: touched.timeline ? validateTimeline(formValues.timeline) : undefined,
      email: touched.email ? validateEmail(formValues.email) : undefined,
    };
  }, [formValues, touched]);

  const handleChange = (field: keyof typeof formValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const value = e.currentTarget.value;
    setFormValues((prev) => ({ ...prev, [field]: value }));
    if (!touched[field]) {
      setTouched((prev) => ({ ...prev, [field]: true }));
    }
  };

  const formSuccess = actionData?.success === true;

  return (
    <div className={styles.page}>
      <CpgLabsNav />

      {/* ── Hero ── */}
      <section id="hero" className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroHeadline}>
              How much do you spend on Shopify apps?
              <br />
              <span className={styles.heroEmphasis}>
                And how much of it do you actually use?
              </span>
            </h1>
            <p className={styles.heroSub}>
              Add up your last three Shopify app invoices. If it&apos;s north
              of $150 and you&apos;re only using half the features, we write
              the one custom feature you&apos;d rather have. $300 to $500
              setup, $30 to $50 a month hosting.
            </p>
            <div className={styles.heroCtas}>
              <a
                id="hero-cta"
                href="#pain-form"
                className={styles.ctaPrimary}
              >
                Describe your pain
              </a>
              <a href={CALENDLY_URL} className={styles.heroSecondaryLink}>
                or book 20 minutes to talk it through
              </a>
            </div>
          </div>

          <div className={styles.heroVisual} aria-hidden="false">
            <HeroCostStack />
          </div>
        </div>
      </section>

      {/* ── Wedge strip ── */}
      <section className={styles.wedgeStrip} aria-label="Common pains">
        <div className={styles.wedgeInner}>
          <a href="#examples" className={styles.wedgeChip}>
            App bloat tax
          </a>
          <a href="#examples" className={styles.wedgeChip}>
            Unmet feature
          </a>
          <a href="#how-it-works" className={styles.wedgeChip}>
            Ship in days
          </a>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className={styles.howItWorks}>
        <h2 className={styles.sectionTitle}>
          From pain to shipped, in three steps.
        </h2>
        <div className={styles.stepsGrid}>
          {HOW_IT_WORKS.map((step) => (
            <div key={step.step} className={styles.stepCard}>
              <span className={styles.stepNumber}>{step.step}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Example builds ── */}
      <section id="examples" className={styles.examples}>
        <h2 className={styles.sectionTitle}>Example builds.</h2>
        <p className={styles.sectionSubtitle}>
          Synthetic data. Your build is scoped to your store.
        </p>

        <div className={styles.examplesGrid}>
          {/* Example 1 — Inventory sync */}
          <article className={styles.exampleCard}>
            <div
              className={styles.examplePlaceholder}
              role="img"
              aria-label="Example screenshot, synthetic demo data"
            >
              <span className={styles.examplePlaceholderText}>CPG Labs</span>
            </div>
            <h3 className={styles.exampleTitle}>
              Inventory sync with auto-reconciliation
            </h3>

            <p className={styles.exampleBody}>
              <strong>Pain.</strong> Stock drift across Shopify, Amazon, and
              wholesale. Every Monday someone manually reconciles.
            </p>
            <p className={styles.exampleBody}>
              <strong>Fix.</strong> Webhook-driven sync inside your Shopify
              admin. Emails a summary only when a human is actually needed.
            </p>
            <p className={styles.exampleBody}>
              <strong>Outcome.</strong> 4 hours of weekly reconciliation, gone.
            </p>
            <p className={styles.exampleWorksFor}>
              <strong>Works for:</strong> food and beverage, beauty, and
              supplements running multi-channel.
            </p>
          </article>

          {/* Example 2 — Conditional pricing */}
          <article className={styles.exampleCard}>
            <div
              className={styles.examplePlaceholder}
              role="img"
              aria-label="Example screenshot, synthetic demo data"
            >
              <span className={styles.examplePlaceholderText}>CPG Labs</span>
            </div>
            <h3 className={styles.exampleTitle}>
              Conditional pricing with customer-tag logic
            </h3>

            <p className={styles.exampleBody}>
              <strong>Pain.</strong> Wholesale tiers, subscriber discounts, and
              bundle rules stacking 3 or 4 apps that collide at checkout.
            </p>
            <p className={styles.exampleBody}>
              <strong>Fix.</strong> One embedded app reading customer tag,
              order history, and cart to apply the right rule at checkout.
            </p>
            <p className={styles.exampleBody}>
              <strong>Outcome.</strong> Zero stacked-discount incidents in
              4 months.
            </p>
            <p className={styles.exampleWorksFor}>
              <strong>Works for:</strong> food and beverage, beauty
              subscriptions, supplements with kits and bundles.
            </p>
          </article>
        </div>
      </section>

      {/* ── How we build (technical credibility) ── */}
      <section id="how-we-build" className={styles.howWeBuild}>
        <h2 className={styles.sectionTitle}>Production code, not prototypes.</h2>
        <p className={styles.howWeBuildBody}>
          Built on the same stack Shopify uses for its own embedded apps. Real
          logging, real backups, real embedded apps. AI handles the boilerplate.
          A senior engineer reviews every line that touches your store.
        </p>
        <div className={styles.stackRow}>
          <span className={styles.stackItem}>React Router</span>
          <span className={styles.stackDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.stackItem}>TypeScript</span>
          <span className={styles.stackDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.stackItem}>Prisma</span>
          <span className={styles.stackDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.stackItem}>Shopify Admin API</span>
          <span className={styles.stackDot} aria-hidden="true">
            ·
          </span>
          <span className={styles.stackItem}>AWS</span>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className={styles.pricing}>
        <h2 className={styles.sectionTitle}>
          You pay for the service, not the feature count.
        </h2>
        <div className={styles.pricingGrid}>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingCardTitle}>Setup fee</h3>
            <p className={styles.pricingCardPrice}>
              <strong>$300 to $500</strong> per service, one time
            </p>
            <p className={styles.pricingCardBody}>
              Charged after you test it on your store and sign off.
            </p>
          </div>
          <div className={styles.pricingCard}>
            <h3 className={styles.pricingCardTitle}>Hosting</h3>
            <p className={styles.pricingCardPrice}>
              <strong>$30 to $50</strong> per month per service
            </p>
            <p className={styles.pricingCardBody}>
              Covers AWS, monitoring, and ongoing fixes.
            </p>
          </div>
        </div>
        <p className={styles.pricingFootnote}>
          No per-seat, no per-order, no usage tiers. One service, one line
          item. Cancel a service and the line item goes away. You own your
          data. We host the code.
        </p>
      </section>

      {/* ── LTV expansion ── */}
      <section id="ltv" className={styles.ltv}>
        <h2 className={styles.sectionTitle}>One app. Add to it over time.</h2>
        <p className={styles.ltvBody}>
          Start with one service. Add more as new bottlenecks show up, all
          inside the same CPG Labs app. Same login, one monthly bill.
        </p>
        <div className={styles.ltvTimeline}>
          {LTV_STEPS.map((step, i) => (
            <div key={step.label} className={styles.ltvStepWrap}>
              <div className={styles.ltvStep}>
                <span className={styles.ltvStepIcon} aria-hidden="true" />
                <span className={styles.ltvStepLabel}>{step.label}</span>
                <span className={styles.ltvStepNote}>{step.note}</span>
              </div>
              {i < LTV_STEPS.length - 1 && (
                <span className={styles.ltvArrow} aria-hidden="true">
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className={styles.faq}>
        <h2 className={styles.sectionTitle}>Before you send the form.</h2>
        <div className={styles.faqList}>
          {FAQS.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{item.q}</summary>
              <p className={styles.faqAnswer}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Final CTA — Form ── */}
      <section id="pain-form" className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <h2 className={styles.sectionTitle}>
            Tell us what&apos;s eating your week.
          </h2>
          <p className={styles.finalCtaBody}>
            Five fields, no call. Fixed price and timeline back in 48 hours.
            If it&apos;s not a fit, we say so.
          </p>

          {formSuccess ? (
            <div className={styles.formSuccess} role="status">
              Thanks. We&apos;ll read this and reply within 48 hours.
            </div>
          ) : (
            <Form method="post" className={styles.painForm} noValidate>
              <input type="hidden" name="intent" value="lead" />
              {/* Honeypot — visually hidden, not display:none (bots skip display:none). */}
              <div className={styles.honeypot} aria-hidden="true">
                <label htmlFor="website">
                  Leave this field empty
                  <input
                    type="text"
                    id="website"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </label>
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="store_url" className={styles.fieldLabel}>
                  Store URL
                </label>
                <input
                  id="store_url"
                  type="url"
                  name="store_url"
                  required
                  placeholder="https://yourstore.myshopify.com"
                  autoComplete="url"
                  value={formValues.store_url}
                  onChange={handleChange("store_url")}
                  onBlur={() => setTouched((t) => ({ ...t, store_url: true }))}
                  className={`${styles.fieldInput}${
                    errors.store_url ? ` ${styles.fieldInputError}` : ""
                  }`}
                  aria-invalid={errors.store_url ? true : undefined}
                  aria-describedby={
                    errors.store_url ? "store_url-error" : undefined
                  }
                />
                {errors.store_url && (
                  <p id="store_url-error" className={styles.fieldError}>
                    {errors.store_url}
                  </p>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="pain" className={styles.fieldLabel}>
                  What&apos;s broken in your own words
                </label>
                <textarea
                  id="pain"
                  name="pain"
                  required
                  rows={4}
                  maxLength={1000}
                  placeholder="The workflow that's eating your week."
                  autoComplete="off"
                  value={formValues.pain}
                  onChange={handleChange("pain")}
                  onBlur={() => setTouched((t) => ({ ...t, pain: true }))}
                  className={`${styles.fieldTextarea}${
                    errors.pain ? ` ${styles.fieldInputError}` : ""
                  }`}
                  aria-invalid={errors.pain ? true : undefined}
                  aria-describedby={errors.pain ? "pain-error" : undefined}
                />
                {errors.pain && (
                  <p id="pain-error" className={styles.fieldError}>
                    {errors.pain}
                  </p>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="workaround" className={styles.fieldLabel}>
                  What are you currently doing to cope? <span className={styles.fieldOptional}>(optional)</span>
                </label>
                <textarea
                  id="workaround"
                  name="workaround"
                  rows={2}
                  maxLength={500}
                  placeholder="Spreadsheet, three apps duct-taped together, a VA on Fridays..."
                  autoComplete="off"
                  value={formValues.workaround}
                  onChange={handleChange("workaround")}
                  onBlur={() => setTouched((t) => ({ ...t, workaround: true }))}
                  className={`${styles.fieldTextarea}${
                    errors.workaround ? ` ${styles.fieldInputError}` : ""
                  }`}
                  aria-invalid={errors.workaround ? true : undefined}
                  aria-describedby={
                    errors.workaround ? "workaround-error" : undefined
                  }
                />
                {errors.workaround && (
                  <p id="workaround-error" className={styles.fieldError}>
                    {errors.workaround}
                  </p>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="timeline" className={styles.fieldLabel}>
                  How soon do you need it?
                </label>
                <select
                  id="timeline"
                  name="timeline"
                  required
                  autoComplete="off"
                  value={formValues.timeline}
                  onChange={handleChange("timeline")}
                  onBlur={() => setTouched((t) => ({ ...t, timeline: true }))}
                  className={`${styles.fieldSelect}${
                    errors.timeline ? ` ${styles.fieldInputError}` : ""
                  }`}
                  aria-invalid={errors.timeline ? true : undefined}
                  aria-describedby={
                    errors.timeline ? "timeline-error" : undefined
                  }
                >
                  <option value="" disabled>
                    Pick one
                  </option>
                  {TIMELINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.timeline && (
                  <p id="timeline-error" className={styles.fieldError}>
                    {errors.timeline}
                  </p>
                )}
              </div>

              <div className={styles.fieldGroup}>
                <label htmlFor="email" className={styles.fieldLabel}>
                  Where should we email you back?
                </label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  required
                  placeholder="you@brand.com"
                  autoComplete="email"
                  value={formValues.email}
                  onChange={handleChange("email")}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  className={`${styles.fieldInput}${
                    errors.email ? ` ${styles.fieldInputError}` : ""
                  }`}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "email-error" : undefined}
                />
                {errors.email && (
                  <p id="email-error" className={styles.fieldError}>
                    {errors.email}
                  </p>
                )}
              </div>

              {actionData?.error && (
                <p className={styles.formError} role="alert">
                  {actionData.error}
                </p>
              )}

              <button
                id="form-submit"
                type="submit"
                className={styles.ctaPrimary}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Sending..." : "Send it"}
              </button>

              <a href={CALENDLY_URL} className={styles.formSecondaryLink}>
                Or book 20 minutes to talk it through
              </a>
            </Form>
          )}
        </div>
      </section>

      <CpgLabsFooter />
    </div>
  );
}
