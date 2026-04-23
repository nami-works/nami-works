import type { MetaFunction } from "react-router";
import styles from "./screencast/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Omnify — Local delivery and retail planning for Shopify" },
  {
    name: "description",
    content:
      "See how Omnify helps FMCG brands plan local delivery routes, track retail sales, and decide where to open next. A Shopify-embedded app by CPG Labs.",
  },
  { property: "og:title", content: "Omnify in action" },
  {
    property: "og:description",
    content:
      "Shopify-embedded app for local delivery, retail sales, and footprint planning. By CPG Labs.",
  },
];

export default function Screencast() {
  return (
    <main className={styles.root}>
      <header className={styles.topBar}>
        <a href="https://cpg-labs.io/" className={styles.backLink}>
          ← CPG Labs
        </a>
      </header>

      <section className={styles.hero}>
        <div className={styles.logoWrap}>
          <img src="/omnify_tree.png" alt="" className={styles.logo} />
        </div>
        <h1 className={styles.title}>
          <span className={styles.titleHolo}>Omnify</span>
        </h1>
        <p className={styles.subtitle}>
          Local delivery, retail sales, footprint planning. A
          Shopify-embedded app for FMCG brands operating omnichannel.
        </p>
      </section>

      <section className={styles.videoSection}>
        <div className={styles.videoFrame}>
          <video
            className={styles.video}
            controls
            autoPlay
            muted
            playsInline
          >
            <source src="/screencast.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>
          Published by{" "}
          <a href="https://cpg-labs.io/">CPG Labs</a>
          {" · "}
          <a href="mailto:contact@cpg-labs.io">contact@cpg-labs.io</a>
        </p>
      </footer>
    </main>
  );
}
