import type { MetaFunction } from "react-router";
import styles from "./screencast/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Omnify | Screencast" },
  { name: "description", content: "Omnify product screencast." },
];

export default function Screencast() {
  return (
    <main className={styles.page}>
      <img className={styles.logo} src="/omnify_tree.png" alt="Omnify logo" />
      <h1 className={styles.title}>Screencast</h1>
      <p className={styles.text}>
        This screencast shows an example of Omnify app being used on a Shopify store.
        </p>
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
    </main>
  );
}
