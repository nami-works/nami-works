import type { MetaFunction } from "react-router";
import styles from "./_site.about/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "CPG Labs | About" },
  {
    name: "description",
    content:
      "CPG Labs levels the playing field for independent consumer brands with enterprise-grade retail tools.",
  },
];

export default function About() {
  return (
    <main className={styles.page}>
      <h1 className={styles.headline}>About CPG Labs</h1>

      <div className={styles.mission}>
        <p className={styles.text}>
          Our goal is to <strong>level the playing field</strong> for{" "}
          <u>independent</u> consumer brands. We build tools to deliver{" "}
          <strong>competitive edge</strong> to growing companies, so they can
          compete at <u>enterprise-level</u>, without enterprise budgets.
        </p>
        <p className={styles.text}>
          From <strong>local stores visibility</strong> to{" "}
          <strong>last-mile delivery intelligence</strong> and{" "}
          <strong>footprint expansion insights,</strong> we give{" "}
          <u>independent CPG brands</u> the same reach and intelligence the big
          players take for granted.
        </p>
      </div>

      <section className={styles.productsSection}>
        <div className={styles.productCard}>
          <img
            src="/omnify-logo.png"
            alt="Omnify"
            className={styles.productLogo}
          />
          <p className={styles.productSubtitle}>
            Omnify is a location management technology developed and operated by
            CPG Labs.
          </p>
          <p className={styles.productDescription}>
            Google Business Profile sync, local delivery planning, sales goals,
            and retail expansion analytics, all at Omnify dashboard or in the
            Shopify admin.
          </p>
        </div>
      </section>

      <p className={styles.bottomInfo}>
        contact@cpg-labs.io &middot; Sao Paulo, Brazil
      </p>
    </main>
  );
}
