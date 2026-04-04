import { useState, useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, Link } from "react-router";

import { SiteNav, SiteFooter } from "../../components/site-layout";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app/local-delivery?${url.searchParams.toString()}`);
  }

  return {};
};

// ── Rotating placeholder animation ──
const PLACEHOLDER_STRINGS = [
  "specialty-coffee.co",
  "delicious-icecream.com",
  "cleansing-shampoo.beauty",
  "organic-supplements.shop",
  "artisan-candles.co",
  "fresh-juice-bar.com",
  "handmade-soaps.store",
  "craft-brewery.beer",
];

function useRotatingPlaceholder() {
  const [display, setDisplay] = useState("");
  const [strIndex, setStrIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = PLACEHOLDER_STRINGS[strIndex];

    if (!isDeleting && charIndex <= current.length) {
      // Typing
      if (charIndex === current.length) {
        // Pause before deleting
        const timeout = setTimeout(() => setIsDeleting(true), 2000);
        return () => clearTimeout(timeout);
      }
      const timeout = setTimeout(() => {
        setDisplay(current.slice(0, charIndex + 1));
        setCharIndex((c) => c + 1);
      }, 50);
      return () => clearTimeout(timeout);
    }

    if (isDeleting && charIndex >= 0) {
      if (charIndex === 0) {
        // Move to next string
        setIsDeleting(false);
        setStrIndex((i) => (i + 1) % PLACEHOLDER_STRINGS.length);
        setDisplay("");
        return;
      }
      const timeout = setTimeout(() => {
        setDisplay(current.slice(0, charIndex - 1));
        setCharIndex((c) => c - 1);
      }, 30);
      return () => clearTimeout(timeout);
    }
  }, [charIndex, isDeleting, strIndex]);

  return display;
}

// ── SVG icon defs for holographic gradient ──
function HoloGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="holo-fill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5ecece" />
          <stop offset="50%" stopColor="#b09fda" />
          <stop offset="100%" stopColor="#e8a0bf" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className={styles.pillarIcon} viewBox="0 0 48 48" fill="none">
      <path
        d="M24 4C16.28 4 10 10.28 10 18c0 11 14 26 14 26s14-15 14-26c0-7.72-6.28-14-14-14zm0 19a5 5 0 110-10 5 5 0 010 10z"
        fill="url(#holo-fill)"
      />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg className={styles.pillarIcon} viewBox="0 0 48 48" fill="none">
      <path
        d="M40 20h-4V12H6a4 4 0 00-4 4v20h4a6 6 0 0012 0h12a6 6 0 0012 0h4v-8l-6-8zM12 38a3 3 0 110-6 3 3 0 010 6zm27-14.5l3.5 4.5H36v-6h1.5l1.5 1.5zM36 38a3 3 0 110-6 3 3 0 010 6z"
        fill="url(#holo-fill)"
      />
    </svg>
  );
}

function GrowthIcon() {
  return (
    <svg className={styles.pillarIcon} viewBox="0 0 48 48" fill="none">
      <path
        d="M8 36l10-10 6 6L38 16v6h4V6H26v4h6l-12 14-6-6L4 28v8h4z"
        fill="url(#holo-fill)"
      />
    </svg>
  );
}

// ── Smooth scroll helper ──
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

// ── Check items for GBP section ──
const GBP_CHECKS = [
  "Missing or inconsistent info",
  "Outdated hours",
  "Unverified locations",
  "Low photo count",
  "Review response rate",
  "Category match",
];

export default function HomePage() {
  const placeholder = useRotatingPlaceholder();
  const [showNotify, setShowNotify] = useState(false);

  return (
    <>
      <SiteNav />
      <HoloGradientDefs />

      {/* ── Section 1: Hero ── */}
      <section className={styles.hero}>
        <h1 className={styles.heroHeadline}>
          Make your store
          <br />
          <strong className={styles.heroEmphasis}>IMPOSSIBLE</strong>
          <br />
          to miss!
        </h1>
        <p className={styles.heroSub}>
          Manage your whole presence on Google Maps seamlessly, directly at
          Omnify dashboard or your Shopify admin.
        </p>
        <div className={styles.heroCtas}>
          <button
            className={styles.ctaPrimary}
            onClick={() => scrollTo("gbp-health-check")}
          >
            Check your store health
          </button>
          <button
            className={styles.ctaGhost}
            onClick={() => scrollTo("pillars")}
          >
            See how it works
          </button>
        </div>
        <div className={styles.laptopMockup} />
      </section>

      {/* ── Section 2: Three Pillars ── */}
      <section className={styles.pillars} id="pillars">
        <h2 className={styles.sectionTitle}>
          Omnify is the location management platform built for Shopify.
        </h2>
        <div className={styles.pillarsGrid}>
          <div className={styles.pillarCard}>
            <PinIcon />
            <p className={styles.pillarLabel}>Show Up</p>
            <h3 className={styles.pillarHeading}>
              Let your <strong>customers find you</strong> where they are
              searching.
            </h3>
            <p className={styles.pillarDesc}>
              Manage your listings, keep hours accurate, respond to reviews.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <TruckIcon />
            <p className={styles.pillarLabel}>Go Local</p>
            <h3 className={styles.pillarHeading}>
              Promise, and <strong>deliver</strong>.
            </h3>
            <p className={styles.pillarDesc}>
              Plan routes, track drivers and manage deliveries, from the admin.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <GrowthIcon />
            <p className={styles.pillarLabel}>Expand</p>
            <h3 className={styles.pillarHeading}>
              Know exactly what door to <strong>open next</strong>.
            </h3>
            <p className={styles.pillarDesc}>
              Expansion analytics that combine your sales data with market
              signals.
            </p>
          </div>
        </div>
      </section>

      {/* ── Section 3: GBP Health Check ── */}
      <section className={styles.gbpSection} id="gbp-health-check">
        <h2 className={styles.gbpTitle}>Free Google Health Check</h2>
        <p className={styles.gbpSubtitle}>
          Instantly see how your stores appear on Google.
        </p>

        {!showNotify ? (
          <>
            <div className={styles.gbpInputRow}>
              <input
                className={styles.gbpInput}
                type="text"
                placeholder={placeholder}
                readOnly
              />
              <button
                className={styles.scanBtn}
                onClick={() => setShowNotify(true)}
              >
                Scan Now
              </button>
            </div>
            <div className={styles.checkGrid}>
              {GBP_CHECKS.map((label) => (
                <div key={label} className={styles.checkItem}>
                  <span className={styles.checkMark}>&#10003;</span>
                  {label}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.notifyWrap}>
            <p className={styles.notifyText}>
              We&apos;re launching soon. Enter your email to get notified.
            </p>
            <div className={styles.notifyRow}>
              <input
                className={styles.notifyInput}
                type="email"
                placeholder="you@example.com"
              />
              <button className={styles.notifyBtn}>Notify Me</button>
            </div>
          </div>
        )}
      </section>

      {/* ── Section 4: Built On ── */}
      <section className={styles.builtOn}>
        <h2 className={styles.builtOnTitle}>Built with</h2>
        <div className={styles.builtOnRow}>
          <div className={styles.builtOnItem}>
            <span className={styles.builtOnLogo}>Your store</span>
            <span className={styles.builtOnLabel}>accurate data</span>
          </div>
          <div className={styles.builtOnItem}>
            <span className={styles.builtOnLogo}>AWS</span>
            <span className={styles.builtOnLabel}>Infrastructure</span>
          </div>
        </div>
      </section>

      {/* ── Section 5: Final CTA ── */}
      <section className={styles.finalCta}>
        <h2 className={styles.finalHeading}>
          Ready to gain full control of your offline footprint?
        </h2>
        <Link to="/pricing" className={styles.finalBtn}>
          Get Started
        </Link>
      </section>

      <SiteFooter />
    </>
  );
}
