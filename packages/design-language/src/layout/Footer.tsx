import type { ReactNode } from 'react';

export interface FooterProps {
  /** Legal-row items (GDPR · Soukromí · Podmínky · Cookies). */
  legal?: ReadonlyArray<ReactNode>;
  /** The closing line — wordmark, offices, contact, © year. */
  children?: ReactNode;
}

/**
 * Footer — the two-tier site/app footer: a quiet legal row over a wordmark +
 * offices (Brno / Bratislava) + contact line. Small muted text.
 */
export const Footer = ({ legal = [], children }: FooterProps) => (
  <footer className="rdl-footer">
    {legal.length ? (
      <div className="rdl-footer__legal">
        {legal.map((item, i) => (
          <span key={i}>{item}</span>
        ))}
      </div>
    ) : null}
    <div>{children}</div>
  </footer>
);
