import type { ReactNode } from "react";

export type TabItem = {
  id: string;
  label: string;
  href?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type TabBarProps = {
  tabs: TabItem[];
  activeId: string;
  className?: string;
  tabClassName?: string;
  activeTabClassName?: string;
  contentClassName?: string;
  iconClassName?: string;
  activeIconClassName?: string;
};

const joinClasses = (...values: Array<string | undefined | false>) =>
  values.filter(Boolean).join(" ");

export const TabBar = ({
  tabs,
  activeId,
  className,
  tabClassName,
  activeTabClassName,
  contentClassName,
  iconClassName,
  activeIconClassName,
}: TabBarProps) => {
  return (
    <div className={className}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const tabClasses = joinClasses(
          tabClassName,
          isActive && activeTabClassName,
        );
        const iconClasses = joinClasses(
          iconClassName,
          isActive && activeIconClassName,
        );
        const content = (
          <span className={contentClassName}>
            {tab.icon ? <span className={iconClasses}>{tab.icon}</span> : null}
            <span>{tab.label}</span>
          </span>
        );

        if (tab.href) {
          return (
            <span key={tab.id} className={tabClasses}>
              <s-link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={tab.disabled ? "true" : undefined}
              >
                {content}
              </s-link>
            </span>
          );
        }

        return (
          <span key={tab.id} className={tabClasses}>
            {content}
          </span>
        );
      })}
    </div>
  );
};
