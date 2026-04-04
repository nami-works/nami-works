import { useState } from "react";
import type { MetaFunction } from "react-router";
import styles from "./_site.pricing/styles.module.css";

export const meta: MetaFunction = () => [
  { title: "CPG Labs | Pricing" },
  {
    name: "description",
    content:
      "Simple, transparent pricing for CPG Labs. No sales calls. No hidden fees.",
  },
];

interface Plan {
  name: string;
  price: number;
  locations: string;
  extra?: string;
  features: string[];
  recommended: boolean;
}

const plans: Plan[] = [
  {
    name: "Start",
    price: 25,
    locations: "Up to 3 locations",
    features: ["GBP sync", "Health check", "Basic analytics"],
    recommended: false,
  },
  {
    name: "Grow",
    price: 49,
    locations: "Up to 10 locations",
    extra: "+$7/mo each additional",
    features: [
      "Everything in Start, plus:",
      "Unlimited locations",
      "Review management",
      "Local delivery",
    ],
    recommended: true,
  },
  {
    name: "Scale",
    price: 99,
    locations: "Up to 10 locations",
    extra: "+$10/mo each additional",
    features: [
      "Everything in Grow, plus:",
      "Expansion analytics",
      "Multi-brand support",
      "Priority support",
    ],
    recommended: false,
  },
];

export default function Pricing() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Start: false,
    Grow: true,
    Scale: false,
  });

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.headline}>Simple, transparent pricing.</h1>
        <p className={styles.sub}>No sales calls. No hidden fees.</p>
      </div>

      <div className={styles.grid}>
        {plans.map((plan) => {
          const isExpanded = expanded[plan.name];
          const isCollapsible = !plan.recommended;

          const card = (
            <div
              className={`${styles.card} ${plan.recommended ? styles.cardRecommended : ""} ${isCollapsible && !isExpanded ? styles.cardCollapsed : ""}`}
              onClick={isCollapsible ? () => toggle(plan.name) : undefined}
              role={isCollapsible ? "button" : undefined}
              aria-expanded={isCollapsible ? isExpanded : undefined}
              style={isCollapsible ? { cursor: "pointer" } : undefined}
            >
              {plan.recommended && (
                <span className={styles.badge}>Recommended</span>
              )}
              <h2 className={styles.planName}>{plan.name}</h2>
              <div className={styles.priceRow}>
                <span className={styles.price}>${plan.price}</span>
                <span className={styles.period}>/mo</span>
              </div>
              <p className={styles.locations}>{plan.locations}</p>
              {isExpanded && (
                <>
                  {plan.extra && <p className={styles.extra}>{plan.extra}</p>}
                  <ul className={styles.features}>
                    {plan.features.map((f) => (
                      <li key={f} className={styles.feature}>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    className={
                      plan.recommended ? styles.ctaHolo : styles.ctaGhost
                    }
                    onClick={(e) => e.stopPropagation()}
                  >
                    Get Started
                  </button>
                </>
              )}
              {isCollapsible && !isExpanded && (
                <span className={styles.expandHint}>See details</span>
              )}
            </div>
          );

          if (plan.recommended) {
            return (
              <div key={plan.name} className={styles.holoWrap}>
                {card}
              </div>
            );
          }

          return <div key={plan.name}>{card}</div>;
        })}
      </div>

      <p className={styles.footer}>
        All plans include HTTPS, encryption at rest, and Google API Services
        compliance.
      </p>
    </main>
  );
}
