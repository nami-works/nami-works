import type { MetaFunction } from "react-router";
import styles from "./_site.contact/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "CPG Labs | Contact" },
  {
    name: "description",
    content: "Get in touch with CPG Labs for inquiries, security reports, or partnerships.",
  },
];

function MailIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13L2 4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

const contactItems = [
  {
    icon: <MailIcon />,
    label: "General inquiries",
    value: "contact@cpg-labs.io",
    href: "mailto:contact@cpg-labs.io",
  },
  {
    icon: <ShieldIcon />,
    label: "Security reports",
    value: "security@cpg-labs.io",
    href: "mailto:security@cpg-labs.io",
  },
  {
    icon: <UsersIcon />,
    label: "Partnerships",
    value: "partners@cpg-labs.io",
    href: "mailto:partners@cpg-labs.io",
  },
  {
    icon: <MapPinIcon />,
    label: "Location",
    value: "Sao Paulo, SP — Brazil",
  },
];

export default function Contact() {
  return (
    <main className={styles.page}>
      <h1 className={styles.headline}>Get in Touch</h1>

      <div className={styles.card}>
        {contactItems.map((item, i) => (
          <div
            key={item.label}
            className={`${styles.item} ${i < contactItems.length - 1 ? styles.itemBorder : ""}`}
          >
            <div className={styles.iconWrap}>{item.icon}</div>
            <div className={styles.itemContent}>
              <span className={styles.label}>{item.label}</span>
              {item.href ? (
                <a href={item.href} className={styles.value}>
                  {item.value}
                </a>
              ) : (
                <span className={styles.value}>{item.value}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
