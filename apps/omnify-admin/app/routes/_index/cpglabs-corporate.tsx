import { useEffect, useState } from "react";

import styles from "./cpglabs-corporate.module.css";

export function CpgLabsCorporate() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.root}>
      <nav className={`${styles.nav}${scrolled ? ` ${styles.navScrolled}` : ""}`}>
        <div className={styles.navInner}>
          <a href="#hero" className={styles.brand}>
            <img
              src="/cpg-labs_box.png"
              alt=""
              aria-hidden="true"
              className={styles.brandImg}
            />
            <span>CPG Labs</span>
          </a>
          <ul className={styles.navLinks}>
            <li className={styles.navLinkHideMobile}>
              <a href="#products" className={styles.navLink}>
                Products
              </a>
            </li>
            <li className={styles.navLinkHideMobile}>
              <a href="#about" className={styles.navLink}>
                About
              </a>
            </li>
            <li className={styles.navLinkHideMobile}>
              <a href="#contact" className={styles.navLink}>
                Contact
              </a>
            </li>
            <li>
              <a
                href="https://omnify.cpg-labs.io/screencast"
                className={`${styles.navLink} ${styles.navLinkCta}`}
              >
                See Omnify →
              </a>
            </li>
          </ul>
        </div>
      </nav>

      <section className={styles.hero} id="hero">
        <div className={styles.container}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <h1 className={styles.heroHeadline}>
                For brands{" "}
                <span className={styles.heroHolo}>dissolving barriers</span>{" "}
                between online and retail.
              </h1>
              <p className={styles.heroSub}>
                CPG Labs is a software studio for FMCG brands operating
                omnichannel on Shopify. We build the operational tools to unify
                e-commerce and retail management, untap footprint expansion and
                enable seamless experiences in all channels.
              </p>
              <div className={styles.heroCtas}>
                <a href="#products" className={styles.ctaPrimary}>
                  See our products
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 7l5 5 5-5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
                <a
                  href="https://omnify.cpg-labs.io/privacy"
                  className={styles.ctaSecondary}
                >
                  View our privacy policy
                </a>
              </div>
            </div>
            <div className={styles.heroVisual}>
              <img
                src="/cpg-labs_box.png"
                alt=""
                className={styles.heroVisualImg}
              />
            </div>
          </div>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.sectionSoft}`}
        id="products"
      >
        <div className={styles.container}>
          <div className={styles.sectionEyebrow}>Our products</div>

          <div className={styles.productsStack}>
            {/* Omnify — featured, live */}
            <article
              className={`${styles.productCard} ${styles.productCardFeatured}`}
            >
              <div>
                <div className={styles.productHeader}>
                  <h3 className={styles.productName}>Omnify</h3>
                  <span
                    className={`${styles.productBadge} ${styles.productBadgeLive}`}
                  >
                    Available
                  </span>
                </div>
                <p className={styles.productTagline}>
                  Local delivery, retail sales, footprint planning.
                </p>
                <p className={styles.productBlurb}>
                  Omnify is a <strong>Shopify-embedded app</strong>. Merchants
                  use it to plan delivery routes from store locations, track
                  retail sales against monthly goals, and plan where to open
                  next using customer geography.
                </p>
                <a
                  href="https://omnify.cpg-labs.io/screencast"
                  className={styles.productCta}
                >
                  See Omnify in action
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M7 5l5 5-5 5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </a>
              </div>
              <div className={styles.productVisual}>
                <AdminScreenshot />
              </div>
            </article>

            {/* Storefront — coming soon */}
            <article
              className={`${styles.productCard} ${styles.storefrontCard}`}
            >
              <div className={styles.productVisual}>
                <div
                  className={styles.storefrontVisual}
                  role="img"
                  aria-label="Storefront preview, a merchandising canvas with price tag badges"
                >
                  <div className={styles.storefrontTile}></div>
                  <div className={styles.storefrontTile}></div>
                  <div className={styles.storefrontTile}></div>
                </div>
              </div>
              <div>
                <div className={styles.productHeader}>
                  <h3 className={styles.productName}>Storefront</h3>
                  <span
                    className={`${styles.productBadge} ${styles.productBadgeWip}`}
                  >
                    Coming soon
                  </span>
                </div>
                <p className={styles.productTagline}>
                  Merchandising, sale campaigns, price tags.
                </p>
                <p className={styles.productBlurb}>
                  Storefront is the next CPG Labs app. It will help merchants
                  run coordinated sale campaigns, tag discounted products
                  across channels, and keep promotional logic consistent
                  between storefront, PDP, and announcement bar.
                </p>
              </div>
              <a
                href="mailto:contact@cpg-labs.io?subject=Storefront%20waitlist"
                className={styles.waitlistCta}
              >
                Join the waitlist
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 10h14M13 5l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </article>
          </div>
        </div>
      </section>

      <section className={styles.section} id="about">
        <div className={styles.container}>
          <div className={styles.sectionEyebrow}>About CPG Labs</div>
          <h2 className={styles.sectionTitle}>
            Worldwide omnichannel solutions, built in Brazil.
          </h2>
          <p className={styles.aboutBody}>
            CPG Labs is an independent software studio building operational
            tools for{" "}
            <strong>FMCG brands running omnichannel on Shopify</strong>. Every
            product is shaped in real merchant operations before it reaches the
            App Store, and maintained directly by the team that ships it.
          </p>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.sectionSoft}`}
        id="contact"
      >
        <div className={styles.container}>
          <div className={styles.sectionEyebrow}>Contact</div>
          <h2 className={styles.sectionTitle}>Get in touch.</h2>
          <div className={styles.contactGrid}>
            <div className={styles.contactBlock}>
              <h4>Email</h4>
              <p>
                <a href="mailto:contact@cpg-labs.io">contact@cpg-labs.io</a>
              </p>
            </div>
            <div className={styles.contactBlock}>
              <h4>Location</h4>
              <p>São Paulo, Brazil</p>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerLinks}>
            <a href="https://omnify.cpg-labs.io/privacy">Privacy</a>
            <a href="https://omnify.cpg-labs.io/terms">Terms</a>
            <a href="https://omnify.cpg-labs.io/security">Security</a>
          </div>
          <div className={styles.footerLegal}>
            CPG Labs &middot; Established 2026 &middot; São Paulo, Brazil
            <br />© 2026 CPG Labs. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function AdminScreenshot() {
  return (
    <div
      className={styles.appShot}
      role="img"
      aria-label="Screenshot of Omnify running inside the Shopify Admin, showing the Local Delivery route planner"
    >
      <div className={styles.appShotChrome}>
        <div className={styles.appShotDots}>
          <span className={`${styles.appShotDot} ${styles.appShotDotRed}`} />
          <span
            className={`${styles.appShotDot} ${styles.appShotDotYellow}`}
          />
          <span
            className={`${styles.appShotDot} ${styles.appShotDotGreen}`}
          />
        </div>
        <div className={styles.appShotUrl}>
          admin.shopify.com/store/<i>merchant</i>/apps/omnify/local-delivery
        </div>
      </div>
      <div className={styles.appShotShopifyBar}>
        <span className={styles.appShotShopifyLeft}>shopify</span>
        <span className={styles.appShotStore}>merchant &middot; dev</span>
      </div>
      <div className={styles.appShotBody}>
        <div className={styles.appShotSidebar}>
          <div className={styles.appShotSidebarGroup}>
            <div className={styles.appShotSidebarItem}>
              <span className={styles.appShotItemDot} />
              Home
            </div>
            <div className={styles.appShotSidebarItem}>
              <span className={styles.appShotItemDot} />
              Orders
            </div>
            <div className={styles.appShotSidebarItem}>
              <span className={styles.appShotItemDot} />
              Products
            </div>
            <div className={styles.appShotSidebarItem}>
              <span className={styles.appShotItemDot} />
              Customers
            </div>
          </div>
          <div className={styles.appShotSidebarGroup}>
            <div className={styles.appShotSidebarLabel}>Apps</div>
            <div
              className={`${styles.appShotSidebarItem} ${styles.appShotSidebarItemActive}`}
            >
              <span className={styles.appShotItemDot} />
              Omnify
            </div>
          </div>
        </div>
        <div className={styles.appShotMain}>
          <div className={styles.appShotMainHeader}>
            <div className={styles.appShotMainTitle}>Local Delivery</div>
            <div className={styles.appShotMainAction}>Optimize routes</div>
          </div>
          <div className={styles.appShotWorkspace}>
            <div className={styles.appShotMapCard}>
              <div className={styles.appShotMapGrid} />
              <svg
                className={styles.appShotRouteLine}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M 50,55 L 32,30 L 48,18 L 68,26 L 78,48 L 64,66 L 50,55"
                  fill="none"
                  stroke="#005bd3"
                  strokeWidth="0.6"
                  strokeDasharray="1.5,1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className={`${styles.appShotPin} ${styles.appShotPinStore}`}
                style={{ left: "50%", top: "55%" }}
              />
              <span
                className={`${styles.appShotPin} ${styles.appShotPinDelivered}`}
                style={{ left: "32%", top: "30%" }}
              />
              <span
                className={`${styles.appShotPin} ${styles.appShotPinDelivered}`}
                style={{ left: "48%", top: "18%" }}
              />
              <span
                className={`${styles.appShotPin} ${styles.appShotPinActive}`}
                style={{ left: "68%", top: "26%" }}
              />
              <span
                className={`${styles.appShotPin} ${styles.appShotPinPending}`}
                style={{ left: "78%", top: "48%" }}
              />
              <span
                className={`${styles.appShotPin} ${styles.appShotPinPending}`}
                style={{ left: "64%", top: "66%" }}
              />
            </div>
            <div className={styles.appShotOrdersList}>
              <div className={styles.appShotOrderRow}>
                <span>#2038</span>
                <span
                  className={`${styles.appShotOrderBadge} ${styles.appShotOrderBadgeDelivered}`}
                >
                  Delivered
                </span>
              </div>
              <div className={styles.appShotOrderRow}>
                <span>#2041</span>
                <span
                  className={`${styles.appShotOrderBadge} ${styles.appShotOrderBadgeDelivered}`}
                >
                  Delivered
                </span>
              </div>
              <div
                className={`${styles.appShotOrderRow} ${styles.appShotOrderRowActive}`}
              >
                <span>#2044</span>
                <span
                  className={`${styles.appShotOrderBadge} ${styles.appShotOrderBadgeActive}`}
                >
                  On route
                </span>
              </div>
              <div className={styles.appShotOrderRow}>
                <span>#2047</span>
                <span
                  className={`${styles.appShotOrderBadge} ${styles.appShotOrderBadgePending}`}
                >
                  Pending
                </span>
              </div>
              <div className={styles.appShotOrderRow}>
                <span>#2051</span>
                <span
                  className={`${styles.appShotOrderBadge} ${styles.appShotOrderBadgePending}`}
                >
                  Pending
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
