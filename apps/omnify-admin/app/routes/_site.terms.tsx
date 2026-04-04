import type { MetaFunction } from "react-router";
import styles from "./_site.terms/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Omnify | Terms of Service" },
  {
    name: "description",
    content:
      "Read the Terms of Service for the Omnify platform by CPG Labs, including service description, data ownership, and account disconnection.",
  },
  { property: "og:title", content: "Omnify Terms of Service" },
  {
    property: "og:description",
    content:
      "Terms governing the use of Omnify, a SaaS platform for local delivery, retail expansion, and business analytics.",
  },
];

export default function Terms() {
  return (
    <main className={styles.content}>
      <h1 className={styles.title}>Terms of Service</h1>
      <div className={styles.meta}>
        <p className={styles.metaText}>Last updated: April 2026</p>
      </div>
      <p className={styles.intro}>
        These Terms of Service govern your access to and use of the Omnify
        platform and related services provided by CPG Labs. By installing,
        accessing, or using the Services, you agree to be bound by these Terms.
        If you do not agree, you must not use the Services.
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>1. Service Description</h2>
        <p className={styles.text}>
          Omnify is a software-as-a-service (SaaS) platform that integrates
          with Shopify to provide merchants with tools for local delivery route
          planning, retail expansion analysis, sales goal tracking, bulk price
          campaign management, carrier service integration, and business
          analytics. The Services are delivered as an embedded Shopify
          application hosted at{" "}
          <a
            href="https://omnify.cpg-labs.io"
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            https://omnify.cpg-labs.io
          </a>
          .
        </p>
        <p className={styles.text}>
          The Services leverage third-party APIs, including the Shopify Admin
          API, Google Maps Platform, and carrier services (such as Lalamove), to
          deliver their functionality. Availability and accuracy of
          third-party-dependent features are subject to the respective
          {"provider's"} service levels and data quality.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>2. User Responsibilities</h2>
        <p className={styles.text}>By using the Services, you represent and warrant that:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>
            You are authorized to manage the Shopify store and associated
            business listings connected to your Omnify account.
          </li>
          <li className={styles.listItem}>
            You will use the Services only for lawful purposes and in
            compliance with all applicable local, state, national, and
            international laws and regulations.
          </li>
          <li className={styles.listItem}>
            You are responsible for the accuracy and legality of the data you
            provide to or through the Services, including product information,
            delivery addresses, and location data.
          </li>
          <li className={styles.listItem}>
            You will maintain the confidentiality of your account credentials
            and are responsible for all activity that occurs under your account.
          </li>
          <li className={styles.listItem}>
            You will promptly notify CPG Labs of any unauthorized access to or
            use of your account.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>3. Authorization and Consent</h2>
        <p className={styles.text}>
          When you install and configure Omnify, you grant CPG Labs permission
          to access your Shopify store data (including orders, products,
          customers, locations, and fulfillment information) through the Shopify
          Admin API, within the scope of the access permissions you approve
          during installation.
        </p>
        <p className={styles.text}>
          You also authorize Omnify to interact with third-party services on
          your behalf, including but not limited to Google Maps Platform for
          geocoding and route planning, and carrier services for delivery
          quotations and dispatch, when you configure and activate these
          integrations within the application.
        </p>
        <p className={styles.text}>
          You may revoke these permissions at any time by uninstalling the app
          from your Shopify store. Upon uninstallation, data processing will
          cease and data will be handled in accordance with our Privacy Policy.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>4. Data Ownership</h2>
        <p className={styles.text}>
          You retain full ownership of all data you provide to or generate
          through the Services, including your Shopify store data, delivery
          routes, analytics results, and campaign configurations. CPG Labs does
          not claim ownership of your data.
        </p>
        <p className={styles.text}>
          CPG Labs acts as a data processor on your behalf. We process your
          data solely for the purpose of providing and improving the Services.
          We do not sell, rent, or trade your data to any third party. Our data
          processing practices are described in detail in our{" "}
          <a href="/privacy" className={styles.link}>
            Privacy Policy
          </a>
          .
        </p>
        <p className={styles.text}>
          You may request an export of your data at any time by contacting us.
          We will provide the data in a machine-readable format within 30 days
          of receiving your request.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>5. Account Disconnection</h2>
        <p className={styles.text}>
          You may disconnect your account from Omnify at any time by
          uninstalling the application from your Shopify store.
        </p>
        <p className={styles.text}>
          Upon disconnection, CPG Labs will disassociate your store data from
          the Services within 7 (seven) business days. During this period, your
          data will not be used for any new processing, and active integrations
          (such as carrier services and route planning) will be immediately
          deactivated. After the 7-business-day disassociation period, your
          data will be permanently deleted from our systems, except where
          retention is required to comply with legal obligations, resolve
          disputes, or enforce our agreements.
        </p>
        <p className={styles.text}>
          If you reinstall the app within the disassociation period, your
          existing configuration and historical data may be restored. After
          permanent deletion, a new installation will start with a clean state.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>6. Transparency</h2>
        <p className={styles.text}>
          CPG Labs is committed to transparency in how the Services operate.
          All significant modifications to your store data performed through
          the Services (such as order tag assignments, fulfillment updates,
          price changes during campaigns, and carrier service registrations) are
          logged and visible within the application interface.
        </p>
        <p className={styles.text}>
          We will notify you of material changes to the Services, including
          changes to data processing practices, new third-party integrations,
          or modifications to these Terms. Notification will be provided
          through the application interface or via the email address associated
          with your Shopify store.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>7. Prohibited Uses</h2>
        <p className={styles.text}>
          You agree not to use the Services to:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>
            Create, promote, or maintain fake business listings, fraudulent
            store locations, or misleading business information.
          </li>
          <li className={styles.listItem}>
            Send unsolicited communications, spam, or bulk messages to
            customers through any feature of the platform.
          </li>
          <li className={styles.listItem}>
            Engage in any form of fraud, deception, or misrepresentation in
            connection with your use of the Services.
          </li>
          <li className={styles.listItem}>
            Attempt to gain unauthorized access to the Services, other user
            accounts, or CPG Labs infrastructure.
          </li>
          <li className={styles.listItem}>
            Reverse engineer, decompile, disassemble, or otherwise attempt to
            derive the source code of the Services.
          </li>
          <li className={styles.listItem}>
            Use the Services in any manner that could disable, overburden,
            damage, or impair the platform or interfere with other users.
          </li>
          <li className={styles.listItem}>
            Violate any applicable law, regulation, or third-party rights in
            connection with your use of the Services.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>8. Limitation of Liability</h2>
        <p className={styles.text}>
          To the maximum extent permitted by applicable law, CPG Labs and its
          officers, directors, employees, and agents shall not be liable for
          any indirect, incidental, special, consequential, or punitive
          damages, including but not limited to loss of profits, data,
          business opportunities, or goodwill, arising out of or related to
          your use of or inability to use the Services.
        </p>
        <p className={styles.text}>
          {"CPG Labs' total aggregate liability for any claims arising under "}
          these Terms shall not exceed the total fees paid by you to CPG Labs
          in the 12 months preceding the claim, or R$ 1,000 (one thousand
          Brazilian reais), whichever is greater.
        </p>
        <p className={styles.text}>
          The Services are provided as-is and as-available without warranties
          of any kind, whether express, implied, or statutory, including but
          not limited to implied warranties of merchantability, fitness for a
          particular purpose, and non-infringement. CPG Labs does not warrant
          that the Services will be uninterrupted, error-free, or that defects
          will be corrected.
        </p>
        <p className={styles.text}>
          CPG Labs is not responsible for the accuracy, availability, or
          reliability of third-party services integrated with the platform,
          including Shopify, Google Maps Platform, and carrier services.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>9. Termination</h2>
        <p className={styles.text}>
          Either party may terminate these Terms at any time. You may
          terminate by uninstalling the Omnify app from your Shopify store.
          CPG Labs may terminate or suspend your access to the Services
          immediately, without prior notice, if:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>
            You breach any material provision of these Terms.
          </li>
          <li className={styles.listItem}>
            Your use of the Services poses a security risk to the platform or
            other users.
          </li>
          <li className={styles.listItem}>
            Your Shopify store is suspended or terminated by Shopify.
          </li>
          <li className={styles.listItem}>
            Continued provision of the Services becomes commercially
            impracticable or legally prohibited.
          </li>
        </ul>
        <p className={styles.text}>
          Upon termination, the provisions of these Terms that by their nature
          should survive (including but not limited to Sections 4, 5, 8, and
          10) shall remain in full force and effect.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>10. Governing Law</h2>
        <p className={styles.text}>
          These Terms shall be governed by and construed in accordance with the
          laws of the Federative Republic of Brazil, without regard to its
          conflict of law provisions.
        </p>
        <p className={styles.text}>
          Any disputes arising out of or relating to these Terms or the
          Services shall be submitted to the exclusive jurisdiction of the
          courts of the city of Sao Paulo, State of Sao Paulo, Brazil. The
          parties agree to submit to the personal jurisdiction of such courts
          and waive any objections based on venue or inconvenient forum.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>11. Contact Us</h2>
        <p className={styles.text}>
          If you have questions about these Terms or need to report a concern,
          please contact us at:
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
  );
}
