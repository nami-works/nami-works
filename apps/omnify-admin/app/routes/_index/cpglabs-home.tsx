import { Form, useActionData } from "react-router";

import { CpgLabsNav, CpgLabsFooter } from "../../components/cpglabs-layout";

import styles from "./cpglabs-home.module.css";

// PLACEHOLDER Calendly link — replace with real URL before launch.
const CALENDLY_URL = "https://calendly.com/cpg-labs/fit-call";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Discovery",
    body: "We learn your stack, your margins, and what's eating your day.",
  },
  {
    step: "02",
    title: "Scoping",
    body: "Fixed scope, fixed price. No scope creep, no retainer treadmill.",
  },
  {
    step: "03",
    title: "Build",
    body: "Weekly shippable milestones. You see progress every Friday.",
  },
  {
    step: "04",
    title: "Deploy",
    body: "Installed inside your Shopify admin. You own the code.",
  },
];

const WHY_POINTS = [
  {
    title: "Own your stack",
    body: "No more renting features. The code lives in your store, on your terms.",
  },
  {
    title: "No subscription tax",
    body: "One build, one price. We replace three to five monthly apps in a single shot.",
  },
  {
    title: "CPG-native engineers",
    body: "We understand inventory, margin, reorder cadence, and unit economics — not just code.",
  },
];

const FAQS = [
  {
    q: "How much does a custom build cost?",
    a: "PLACEHOLDER — Engagements typically range from a flat $X for a tightly scoped tool to $Y for multi-feature builds. We give you a fixed quote before any work begins.",
  },
  {
    q: "How long does a typical engagement take?",
    a: "PLACEHOLDER — Most projects ship in 4 to 8 weeks. We run weekly demos so you see progress the whole way.",
  },
  {
    q: "Do you work with brands outside Shopify?",
    a: "PLACEHOLDER — Shopify is our specialty. We will occasionally take on headless or adjacent stacks if the fit is right.",
  },
  {
    q: "What happens after launch?",
    a: "PLACEHOLDER — You own the code. We offer optional maintenance retainers, but nothing locks you in.",
  },
];

type ActionResult =
  | { ok?: boolean; error?: string; success?: boolean }
  | undefined;

export function CpgLabsHome() {
  const actionData = useActionData() as ActionResult;

  return (
    <div className={styles.page}>
      <CpgLabsNav />

      {/* ── Section 1: Hero ── PLACEHOLDER copy */}
      <section id="hero" className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.heroEyebrow}>Build-to-suit software for CPG brands</p>
          <h1 className={styles.heroHeadline}>
            You&apos;re overpaying for apps
            <br />
            <span className={styles.heroEmphasis}>you don&apos;t need.</span>
          </h1>
          <p className={styles.heroSub}>
            CPG Labs builds custom Shopify software tailored to your brand —
            not another subscription. One build, one price, zero app bloat.
          </p>
          <div className={styles.heroCtas}>
            <a href="#contact" className={styles.ctaPrimary}>
              Book a fit call
            </a>
            <a href="#how-it-works" className={styles.ctaGhost}>
              See how it works
            </a>
          </div>

          {/* PLACEHOLDER: abstract app-bloat illustration */}
          <div className={styles.heroVisual} aria-hidden="true">
            <div className={styles.appStack}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <div key={n} className={styles.appStackRow}>
                  <span className={styles.appStackDot} />
                  <span className={styles.appStackLine} />
                  <span className={styles.appStackPrice}>${n * 29}/mo</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: How It Works ── PLACEHOLDER copy */}
      <section id="how-it-works" className={styles.howItWorks}>
        <h2 className={styles.sectionTitle}>How it works</h2>
        <p className={styles.sectionSubtitle}>
          Four steps from first call to shipped software.
        </p>
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

      {/* ── Section 3: Why CPG Labs ── PLACEHOLDER copy */}
      <section id="why" className={styles.why}>
        <h2 className={styles.sectionTitle}>Why CPG Labs</h2>
        <p className={styles.sectionSubtitle}>
          Build-to-suit vs. off-the-shelf apps that were never made for you.
        </p>
        <div className={styles.whyGrid}>
          {WHY_POINTS.map((point) => (
            <div key={point.title} className={styles.whyCard}>
              <h3 className={styles.whyTitle}>{point.title}</h3>
              <p className={styles.whyBody}>{point.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 4: Social Proof ── PLACEHOLDER */}
      <section id="proof" className={styles.proof}>
        <h2 className={styles.sectionTitle}>Trusted by brands building on Shopify</h2>
        <div className={styles.logoGrid} aria-hidden="true">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className={styles.logoSlot} />
          ))}
        </div>
        <blockquote className={styles.quote}>
          <p className={styles.quoteText}>
            &ldquo;PLACEHOLDER — A real customer quote will live here once we have one we love.&rdquo;
          </p>
          <footer className={styles.quoteAttr}>— Brand name, Role</footer>
        </blockquote>
      </section>

      {/* ── Section 5: FAQ ── PLACEHOLDER copy */}
      <section id="faq" className={styles.faq}>
        <h2 className={styles.sectionTitle}>Frequently asked questions</h2>
        <div className={styles.faqList}>
          {FAQS.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{item.q}</summary>
              <p className={styles.faqAnswer}>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Section 6: Final CTA — Form + Calendly side-by-side ── */}
      <section id="contact" className={styles.contact}>
        <div className={styles.contactInner}>
          <h2 className={styles.contactHeading}>
            Ready to stop renting and start owning?
          </h2>
          <p className={styles.contactSub}>
            Book a 20-minute fit call, or tell us what hurts and we&apos;ll get back to you.
          </p>

          <div className={styles.contactGrid}>
            <div className={styles.contactCard}>
              <h3 className={styles.contactCardTitle}>Book a fit call</h3>
              <p className={styles.contactCardBody}>
                20 minutes, no pitch. We listen, scope out loud, and send you a written quote within 48 hours.
              </p>
              <a
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.ctaPrimary}
              >
                Book a call
              </a>
            </div>

            <div className={styles.contactCard}>
              <h3 className={styles.contactCardTitle}>Tell us what hurts</h3>
              <p className={styles.contactCardBody}>
                Prefer writing first? Drop the details and we&apos;ll reply within one business day.
              </p>
              {actionData?.success ? (
                <p className={styles.contactSuccess}>
                  Thanks. We&apos;ll be in touch shortly.
                </p>
              ) : (
                <Form method="post" className={styles.contactForm}>
                  <input type="hidden" name="intent" value="lead" />
                  <input
                    className={styles.contactInput}
                    type="text"
                    name="name"
                    placeholder="Your name"
                    required
                  />
                  <input
                    className={styles.contactInput}
                    type="email"
                    name="email"
                    placeholder="you@brand.com"
                    required
                  />
                  <input
                    className={styles.contactInput}
                    type="text"
                    name="store_url"
                    placeholder="yourstore.myshopify.com"
                  />
                  <textarea
                    className={styles.contactTextarea}
                    name="what_hurts"
                    placeholder="What's eating your day?"
                    rows={3}
                  />
                  <button type="submit" className={styles.ctaPrimary}>
                    Send it
                  </button>
                  {actionData?.error && (
                    <p className={styles.contactError}>{actionData.error}</p>
                  )}
                </Form>
              )}
            </div>
          </div>
        </div>
      </section>

      <CpgLabsFooter />
    </div>
  );
}
