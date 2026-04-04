import type { MetaFunction } from "react-router";
import styles from "./_site.security/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Omnify | Security" },
  {
    name: "description",
    content:
      "Learn how CPG Labs protects your data with encryption, access controls, and secure infrastructure on the Omnify platform.",
  },
  { property: "og:title", content: "Security at CPG Labs" },
  {
    property: "og:description",
    content:
      "Encryption at rest and in transit, role-based access controls, and AWS infrastructure security for the Omnify platform.",
  },
];

function ShieldIcon() {
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 2l7 4v5c0 5.25-3.5 9.74-7 11-3.5-1.26-7-5.75-7-11V6l7-4z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
      <circle cx="12" cy="16.5" r="1.5" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="15" r="5" />
      <path d="M12 11l7-7" />
      <path d="M15 4l4 4" />
      <path d="M17.5 6.5l-2 2" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="18" r="1" fill="currentColor" />
      <line x1="10" y1="6" x2="18" y2="6" />
      <line x1="10" y1="18" x2="18" y2="18" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <circle cx="12" cy="16" r="0.5" fill="currentColor" />
    </svg>
  );
}

export default function Security() {
  return (
    <main className={styles.content}>
      <div className={styles.hero}>
        <h1 className={styles.title}>Security at CPG Labs</h1>
        <p className={styles.subtitle}>
          We keep your data always safe. Here is how we do it.
        </p>
      </div>

      <div className={styles.grid}>
        {/* Card 1: Encryption at Rest */}
        <div className={styles.card}>
          <ShieldIcon />
          <h2 className={styles.cardTitle}>Encryption at Rest</h2>
          <p className={styles.cardText}>
            All data stored in our databases is encrypted using AES-256
            encryption, the industry standard for data protection. Our
            PostgreSQL databases are hosted on AWS RDS with encryption enabled
            at the storage layer, ensuring that your store data, delivery
            routes, analytics, and configuration are protected even at rest.
          </p>
        </div>

        {/* Card 2: Encryption in Transit */}
        <div className={styles.card}>
          <LockIcon />
          <h2 className={styles.cardTitle}>Encryption in Transit</h2>
          <p className={styles.cardText}>
            Every connection to and from Omnify is encrypted using TLS 1.2 or
            later. This includes communication between your browser and our
            servers, between our application and {"Shopify's"} APIs, between our
            services and Google Maps Platform, and between our infrastructure
            and carrier service providers. No data travels unencrypted.
          </p>
        </div>

        {/* Card 3: Access Controls */}
        <div className={styles.card}>
          <KeyIcon />
          <h2 className={styles.cardTitle}>Access Controls</h2>
          <p className={styles.cardText}>
            We enforce role-based access control (RBAC) with the principle of
            least privilege across our entire infrastructure. Production
            systems require multi-factor authentication (MFA) for access.
            Secrets and API keys are stored in AWS SSM Parameter Store, never
            in code repositories, and are rotated regularly.
          </p>
        </div>

        {/* Card 4: Infrastructure */}
        <div className={styles.card}>
          <ServerIcon />
          <h2 className={styles.cardTitle}>Infrastructure</h2>
          <p className={styles.cardText}>
            Omnify runs on AWS ECS Fargate in the us-east-1 region, inside a
            Virtual Private Cloud (VPC) with private subnets. Our containers
            are serverless and ephemeral, reducing the attack surface.
            Application load balancers handle TLS termination, and all network
            traffic is restricted to only the ports and protocols required for
            operation.
          </p>
        </div>

        {/* Card 5: Data Handling */}
        <div className={styles.card}>
          <DatabaseIcon />
          <h2 className={styles.cardTitle}>Data Handling</h2>
          <p className={styles.cardText}>
            CPG Labs does not sell, rent, or trade your data under any
            circumstances. Your data is processed exclusively to power the
            features you use within the Omnify platform. We access only the
            Shopify scopes you approve during installation, and we comply with
            the Google API Services User Data Policy, including its Limited Use
            requirements.
          </p>
        </div>

        {/* Card 6: Vulnerability Disclosure */}
        <div className={styles.card}>
          <AlertIcon />
          <h2 className={styles.cardTitle}>Vulnerability Disclosure</h2>
          <p className={styles.cardText}>
            We take security reports seriously. If you discover a potential
            security vulnerability in the Omnify platform, please report it
            responsibly to{" "}
            <a href="mailto:security@cpg-labs.io" className={styles.cardLink}>
              security@cpg-labs.io
            </a>
            . We will acknowledge your report within 48 hours and work with
            you to understand and address the issue. We request that you do
            not publicly disclose the vulnerability until we have had an
            opportunity to investigate and remediate it.
          </p>
        </div>
      </div>

      <div className={styles.compliance}>
        <p className={styles.complianceText}>
          Omnify is compliant with the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className={styles.complianceLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}
