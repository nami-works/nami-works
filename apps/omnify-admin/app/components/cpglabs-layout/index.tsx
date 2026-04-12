import { useEffect, useState } from "react";

import { ThemeToggle } from "../site-layout";

import styles from "./styles.module.css";

const NAV_ANCHORS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Example builds", href: "#examples" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

export function CpgLabsNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`${styles.nav}${scrolled ? ` ${styles.navScrolled}` : ""}`}
    >
      <a href="#hero" className={styles.navLogo}>
        CPG Labs
      </a>

      <div className={styles.navRight}>
        <ul className={styles.navLinks}>
          {NAV_ANCHORS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className={styles.navLink}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <a href="#pain-form" className={styles.navCta}>
          Get your tailored app
        </a>

        <ThemeToggle />
      </div>
    </nav>
  );
}

export function CpgLabsFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBrand}>
        <span className={styles.footerBrandText}>
          Custom software for Shopify stores. Priced like an app.
        </span>
      </div>

      <ul className={styles.footerLinks}>
        <li>
          <a
            href="https://omnify.cpg-labs.io/privacy"
            className={styles.footerLink}
          >
            Privacy
          </a>
        </li>
        <li>
          <a
            href="https://omnify.cpg-labs.io/terms"
            className={styles.footerLink}
          >
            Terms
          </a>
        </li>
        <li>
          <a href="https://omnify.cpg-labs.io" className={styles.footerLink}>
            Omnify
          </a>
        </li>
      </ul>

      <div className={styles.footerEmail}>
        <a href="mailto:contact@cpg-labs.io">contact@cpg-labs.io</a>
      </div>

      <div className={styles.footerCopy}>&copy; 2026 CPG Labs</div>
    </footer>
  );
}
