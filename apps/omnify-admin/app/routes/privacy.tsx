import type { MetaFunction } from "react-router";
import styles from "./privacy/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Omnify | Privacy Policy" },
  {
    name: "description",
    content:
      "Read Omnify's privacy policy for the Shopify app, including data use, storage, retention, and security practices.",
  },
  { property: "og:title", content: "Omnify Privacy Policy" },
  {
    property: "og:description",
    content:
      "How Omnify processes merchant and customer data for local delivery, retail expansion, and analytics.",
  },
];

export default function Privacy() {
  return (
    <main className={styles.page}>
        <img
          className={styles.logo}
          src="/omnify-logo.png"
          alt="Omnify logo"
        />
        <h1 className={styles.title}>Privacy Policy</h1>
        <div className={styles.meta}>
          <p className={styles.metaText}>Last updated: 2026-02-06</p>
        </div>
        <p className={styles.text}>
          This Privacy Policy explains how Omnify ("Omnify", "we", "us", or
          "our") collects, uses, stores, and protects personal data when
          merchants use the Omnify Shopify application and related services
          (the "Services").
        </p>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Scope of this policy</h2>
          <p className={styles.text}>This policy applies to:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>The Omnify Shopify embedded app</li>
            <li className={styles.listItem}>
              Omnify-hosted services at https://omnify.cpg-labs.io
            </li>
            <li className={styles.listItem}>
              All features including Local Delivery, Retail Expansion, and
              Analytics
            </li>
          </ul>
          <p className={styles.text}>
            Omnify acts primarily as a data processor on behalf of merchants.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Personal data we process</h2>
          <div className={styles.subsection}>
            <h3 className={styles.subsectionTitle}>Merchant and app data</h3>
            <ul className={styles.list}>
              <li className={styles.listItem}>Shopify shop identifier</li>
              <li className={styles.listItem}>App installation metadata</li>
              <li className={styles.listItem}>Session and authentication tokens</li>
            </ul>
          </div>
          <div className={styles.subsection}>
            <h3 className={styles.subsectionTitle}>
              Order and customer data (via Shopify API)
            </h3>
            <ul className={styles.list}>
              <li className={styles.listItem}>Order identifiers</li>
              <li className={styles.listItem}>Order totals and line items</li>
              <li className={styles.listItem}>
                Fulfillment method and delivery tags
              </li>
              <li className={styles.listItem}>
                Customer city, postal code, and country
              </li>
              <li className={styles.listItem}>
                Delivery address coordinates (derived via geocoding)
              </li>
            </ul>
          </div>
          <div className={styles.subsection}>
            <h3 className={styles.subsectionTitle}>Location and mapping data</h3>
            <ul className={styles.list}>
              <li className={styles.listItem}>
                Fulfillment location coordinates
              </li>
              <li className={styles.listItem}>
                Retail candidate locations entered by merchants
              </li>
              <li className={styles.listItem}>
                Influence radius and geographic analytics
              </li>
            </ul>
          </div>
          <div className={styles.subsection}>
            <h3 className={styles.subsectionTitle}>Technical and usage data</h3>
            <ul className={styles.list}>
              <li className={styles.listItem}>IP address</li>
              <li className={styles.listItem}>Browser and device metadata</li>
              <li className={styles.listItem}>
                Application logs and error reports
              </li>
            </ul>
          </div>
          <p className={styles.text}>
            Omnify does not collect payment card numbers or sensitive personal
            data.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>How we use data</h2>
          <p className={styles.text}>Personal data is processed strictly to:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Enable local delivery route planning and visualization
            </li>
            <li className={styles.listItem}>
              Analyze customer geography for retail expansion decisions
            </li>
            <li className={styles.listItem}>
              Compute sales, revenue, and performance analytics
            </li>
            <li className={styles.listItem}>
              Operate, secure, and improve the Services
            </li>
            <li className={styles.listItem}>Comply with legal obligations</li>
          </ul>
          <p className={styles.text}>
            Data is never used for advertising or resold.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Data storage and persistence</h2>
          <p className={styles.text}>Data is stored using:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              AWS RDS PostgreSQL for app configuration and analytics
            </li>
            <li className={styles.listItem}>
              Shopify order tags for route assignment persistence
            </li>
            <li className={styles.listItem}>
              JSON storage for cached retail expansion analytics
            </li>
            <li className={styles.listItem}>AWS CloudWatch for logs</li>
          </ul>
          <p className={styles.text}>Data is hosted in us-east-1.</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Legal bases for processing</h2>
          <p className={styles.text}>
            We process personal data under the following legal bases:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Performance of a contract with merchants
            </li>
            <li className={styles.listItem}>
              Legitimate interest in operating and improving the Services
            </li>
            <li className={styles.listItem}>Compliance with legal obligations</li>
            <li className={styles.listItem}>Consent where required by law</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>International transfers</h2>
          <p className={styles.text}>
            Personal data may be transferred and processed outside the user's
            jurisdiction, including in the United States. Omnify applies
            appropriate safeguards such as contractual protections and security
            controls.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Data retention</h2>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Order and customer analytics are retained while the merchant
              account is active
            </li>
            <li className={styles.listItem}>
              Cached analytics data is periodically refreshed and overwritten
            </li>
            <li className={styles.listItem}>
              Logs are retained for a limited operational period
            </li>
            <li className={styles.listItem}>
              Data is deleted or anonymized upon app uninstallation, subject to
              legal requirements
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Security measures</h2>
          <p className={styles.text}>Omnify applies:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>TLS encryption in transit</li>
            <li className={styles.listItem}>Encrypted storage at rest</li>
            <li className={styles.listItem}>Role-based access controls</li>
            <li className={styles.listItem}>
              Secure secret management via AWS SSM
            </li>
            <li className={styles.listItem}>Continuous monitoring and logging</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>User rights</h2>
          <p className={styles.text}>
            Depending on jurisdiction (LGPD, GDPR, CCPA/CPRA), users may request:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>Access to personal data</li>
            <li className={styles.listItem}>Correction or deletion</li>
            <li className={styles.listItem}>Data portability</li>
            <li className={styles.listItem}>
              Restriction or objection to processing
            </li>
            <li className={styles.listItem}>Withdrawal of consent</li>
          </ul>
          <p className={styles.text}>
            Requests can be made via the contact details below.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Children's privacy</h2>
          <p className={styles.text}>
            Omnify does not knowingly process personal data of children under 13
            (or under 16 where applicable).
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Changes to this policy</h2>
          <p className={styles.text}>
            This Privacy Policy may be updated periodically. Continued use of
            the Services indicates acceptance of the updated version.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Contact</h2>
          <p className={styles.text}>Email: lucas@cpg-labs.io</p>
        </section>
    </main>
  );
}
