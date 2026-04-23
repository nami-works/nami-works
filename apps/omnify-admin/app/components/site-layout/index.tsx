import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import styles from "./styles.module.css";

// ── Theme Toggle ──────────────────────────────────────────────

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "light") {
      setTheme(current);
    }
  }, []);

  const toggle = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }, [theme]);

  return (
    <button
      className={styles.themeToggle}
      onClick={toggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? (
        /* Moon icon */
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        /* Sun icon */
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
    </button>
  );
}

// ── Navigation ────────────────────────────────────────────────

const NAV_LINKS = [
  { label: "Products", to: "/#pillars" },
  { label: "Pricing", to: "/pricing" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <nav
        className={`${styles.nav}${scrolled ? ` ${styles.navScrolled}` : ""}`}
      >
        <Link to="/" className={styles.navLogo}>
          <img
            src="/omnify_tree.png"
            alt="Omnify"
            className={styles.navLogoImg}
          />
          Omnify
        </Link>

        <div className={styles.navRight}>
          <ul className={styles.navLinks}>
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className={styles.navLink}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <ThemeToggle />

          <button
            className={styles.hamburger}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <svg
              className={styles.hamburgerIcon}
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile overlay */}
      <div
        className={`${styles.mobileOverlay}${mobileOpen ? ` ${styles.mobileOpen}` : ""}`}
      >
        <button
          className={styles.mobileClose}
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {NAV_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={styles.mobileLink}
            onClick={() => setMobileOpen(false)}
          >
            {link.label}
          </Link>
        ))}

        <ThemeToggle />
      </div>
    </>
  );
}

// ── Footer ────────────────────────────────────────────────────

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBrand}>
        <span className={styles.footerBrandText}>
          Omnify is a product of{" "}
          <img
            src="/cpg-labs_box.png"
            alt="CPG Labs"
            className={styles.footerLogoImg}
          />{" "}
          CPG Labs.
        </span>
      </div>

      <ul className={styles.footerLinks}>
        <li>
          <Link to="/privacy" className={styles.footerLink}>
            Privacy
          </Link>
        </li>
        <li>
          <Link to="/terms" className={styles.footerLink}>
            Terms
          </Link>
        </li>
        <li>
          <Link to="/security" className={styles.footerLink}>
            Security
          </Link>
        </li>
      </ul>

      <div className={styles.footerEmail}>
        <a href="mailto:contact@cpg-labs.io">contact@cpg-labs.io</a>
      </div>

      <div className={styles.footerCopy}>
        &copy; 2026 CPG Labs. All rights reserved.
      </div>
    </footer>
  );
}
