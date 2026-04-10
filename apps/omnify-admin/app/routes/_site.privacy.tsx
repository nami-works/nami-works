import type { MetaFunction } from "react-router";
import styles from "./_site.privacy/styles.module.css";

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
    <div className={styles.page}>
      <main className={styles.content}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <div className={styles.meta}>
          <p className={styles.metaText}>Last updated: April 2026</p>
        </div>
        <p className={styles.intro}>
          This Privacy Policy explains how CPG Labs
          {" ("}the operating entity behind Omnify{") "}
          collects, uses, stores, and protects personal data when merchants use
          the Omnify Shopify application and related services.
        </p>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>1. Scope of This Policy</h2>
          <p className={styles.text}>This policy applies to:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>The Omnify Shopify embedded app</li>
            <li className={styles.listItem}>
              Omnify-hosted services at{" "}
              <a
                href="https://omnify.cpg-labs.io"
                className={styles.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                https://omnify.cpg-labs.io
              </a>
            </li>
            <li className={styles.listItem}>
              All features including Local Delivery, Retail Expansion, Sales,
              Storytelling, and Analytics
            </li>
          </ul>
          <p className={styles.text}>
            Omnify acts primarily as a data processor on behalf of merchants. The
            merchant remains the data controller for their customer data.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>2. Personal Data We Process</h2>
          <div className={styles.subsection}>
            <h3 className={styles.subsectionTitle}>Merchant and app data</h3>
            <ul className={styles.list}>
              <li className={styles.listItem}>Shopify shop identifier</li>
              <li className={styles.listItem}>App installation metadata</li>
              <li className={styles.listItem}>
                Session and authentication tokens
              </li>
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
            <h3 className={styles.subsectionTitle}>
              Location and mapping data
            </h3>
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
            <h3 className={styles.subsectionTitle}>
              Technical and usage data
            </h3>
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
            data such as health information, biometric data, or government
            identifiers.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            3. Google API Services User Data Policy Compliance
          </h2>
          <p className={styles.text}>
            {"Omnify's use and transfer of information received from Google APIs will adhere to the "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className={styles.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            {", including the Limited Use requirements."}
          </p>
          <p className={styles.text}>Specifically, Omnify will not:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Sell Google user data to third parties under any circumstances.
            </li>
            <li className={styles.listItem}>
              Use Google user data for serving advertisements, including
              retargeting, personalized, or interest-based advertising.
            </li>
            <li className={styles.listItem}>
              Use Google user data to determine creditworthiness or for lending
              purposes.
            </li>
            <li className={styles.listItem}>
              Use Google user data for artificial intelligence or machine
              learning training purposes that are unrelated to providing or
              improving the user-facing features of the application.
            </li>
            <li className={styles.listItem}>
              Use Google user data for any purpose other than providing or
              improving user-facing features that are prominent in the
              {"application's"} user interface.
            </li>
            <li className={styles.listItem}>
              Transfer Google user data to third parties unless (a) necessary to
              provide or improve user-facing features, (b) required to comply
              with applicable law, (c) needed for security purposes (e.g.,
              investigating abuse), or (d) as part of a merger, acquisition, or
              asset sale with prior user notice and consent.
            </li>
          </ul>
          <p className={styles.text}>
            Google data accessed by Omnify (such as geocoding results and
            mapping data from Google Maps APIs) is used exclusively to power the
            mapping, route planning, and location analytics features visible
            within the application.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>4. How We Use Data</h2>
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
              Provide carrier rate quotations and delivery tracking
            </li>
            <li className={styles.listItem}>
              Operate, secure, and improve the Services
            </li>
            <li className={styles.listItem}>Comply with legal obligations</li>
          </ul>
          <p className={styles.text}>
            Data is never used for advertising, profiling, or resold to third
            parties.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            5. Data Storage and Persistence
          </h2>
          <p className={styles.text}>Data is stored using:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              AWS RDS PostgreSQL (encrypted at rest with AES-256) for app
              configuration and analytics
            </li>
            <li className={styles.listItem}>
              Shopify order tags for route assignment persistence
            </li>
            <li className={styles.listItem}>AWS CloudWatch for application logs</li>
          </ul>
          <p className={styles.text}>
            All data is hosted in the AWS us-east-1 region. Data at rest is
            encrypted using AES-256, and all data in transit is encrypted using
            TLS 1.2 or later.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            6. Legal Bases for Processing
          </h2>
          <p className={styles.text}>
            We process personal data under the following legal bases:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Performance of a contract with merchants who install and use the
              app
            </li>
            <li className={styles.listItem}>
              Legitimate interest in operating, maintaining, and improving the
              Services
            </li>
            <li className={styles.listItem}>
              Compliance with legal obligations, including tax and commerce
              regulations
            </li>
            <li className={styles.listItem}>
              Consent, where specifically required by applicable law
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>7. Third-Party Services</h2>
          <p className={styles.text}>
            Omnify integrates with the following third-party services to provide
            its features:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              <strong>Shopify</strong> — for store data, orders, products, and
              authentication
            </li>
            <li className={styles.listItem}>
              <strong>Google Maps Platform</strong> — for geocoding, route
              visualization, and location analytics
            </li>
            <li className={styles.listItem}>
              <strong>Carrier services</strong> (e.g. Lalamove) — for delivery
              quotation and dispatch, when configured by the merchant
            </li>
            <li className={styles.listItem}>
              <strong>Amazon Web Services</strong> — for infrastructure hosting,
              database, and logging
            </li>
          </ul>
          <p className={styles.text}>
            Data shared with these services is limited to what is necessary for
            the specific feature being used. We do not share data with analytics
            or advertising platforms.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>8. International Transfers</h2>
          <p className={styles.text}>
            Personal data may be transferred and processed outside the {"user's "}
            jurisdiction, including in the United States (AWS us-east-1 region).
            CPG Labs applies appropriate safeguards including contractual data
            protection clauses, encryption in transit and at rest, and
            access controls consistent with industry best practices.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>9. Data Retention</h2>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Order and customer analytics are retained while the merchant
              account is active
            </li>
            <li className={styles.listItem}>
              Cached analytics data is periodically refreshed and overwritten
            </li>
            <li className={styles.listItem}>
              Application logs are retained for up to 90 days for operational
              purposes
            </li>
            <li className={styles.listItem}>
              Upon app uninstallation, merchant data is deleted within 30 days,
              subject to legal retention requirements
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>10. Security Measures</h2>
          <p className={styles.text}>Omnify applies:</p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              TLS 1.2+ encryption for all data in transit
            </li>
            <li className={styles.listItem}>
              AES-256 encryption at rest for databases
            </li>
            <li className={styles.listItem}>
              Role-based access controls with least-privilege principles
            </li>
            <li className={styles.listItem}>
              Secure secret management via AWS SSM Parameter Store
            </li>
            <li className={styles.listItem}>
              VPC network isolation for production infrastructure
            </li>
            <li className={styles.listItem}>
              Continuous monitoring, logging, and alerting
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>11. User Rights</h2>
          <p className={styles.text}>
            Depending on your jurisdiction (LGPD, GDPR, CCPA/CPRA, and other
            applicable privacy laws), you may have the right to:
          </p>
          <ul className={styles.list}>
            <li className={styles.listItem}>
              Access the personal data we process about you
            </li>
            <li className={styles.listItem}>
              Request correction of inaccurate data
            </li>
            <li className={styles.listItem}>
              Request deletion of your personal data
            </li>
            <li className={styles.listItem}>
              Receive a copy of your data in a portable format
            </li>
            <li className={styles.listItem}>
              Object to or restrict certain types of processing
            </li>
            <li className={styles.listItem}>Withdraw consent at any time</li>
          </ul>
          <p className={styles.text}>
            To exercise any of these rights, contact us using the details in
            Section 14 below. We will respond within 30 days of receiving your
            request.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{"12. Children's Privacy"}</h2>
          <p className={styles.text}>
            Omnify does not knowingly process personal data of children under 13
            (or under 16 where applicable under local law). If we become aware
            that we have collected personal data from a child, we will delete it
            promptly.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            13. Changes to This Policy
          </h2>
          <p className={styles.text}>
            This Privacy Policy may be updated periodically to reflect changes
            in our practices or applicable law. We will update the last-updated
            date at the top of this page. Continued use of the Services
            after changes are posted constitutes acceptance of the updated
            policy.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>14. Contact</h2>
          <p className={styles.text}>
            If you have questions about this Privacy Policy or wish to exercise
            your data rights, contact us at:
          </p>
          <p className={styles.text}>
            Email:{" "}
            <a href="mailto:contact@cpg-labs.io" className={styles.link}>
              contact@cpg-labs.io
            </a>
          </p>
          <p className={styles.text}>
            CPG Labs
            <br />
            Sao Paulo, Brazil
          </p>
        </section>
      </main>
    </div>
  );
}
