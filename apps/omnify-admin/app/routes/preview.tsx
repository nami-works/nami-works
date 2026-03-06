import styles from "./preview/styles.module.css";

export default function Preview() {
  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Omnify Preview</h1>
          <p className={styles.subtitle}>
            This page will host an embedded product walkthrough video.
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Video preview</h2>
          <div className={styles.videoPlaceholder}>
            <p className={styles.placeholderText}>
              Video embed will be added here.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
