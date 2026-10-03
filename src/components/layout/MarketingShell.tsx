import { ReactNode } from "react";
import { Outlet } from "react-router-dom";

/**
 * Flags descendants as a "marketing surface". Activates index.css scoped rules
 * (uppercase + 0.3em tracking on headings, brand-orange H3 eyebrows). Admin and
 * member portal routes do NOT pass through this shell, so their headings stay
 * sentence-case.
 *
 * Two usage modes:
 *  - As a route element with children prop: <MarketingShell><Page /></MarketingShell>
 *  - As a group-route layout (no children): renders <Outlet />
 */
export const MarketingShell = ({ children }: { children?: ReactNode }) => (
  <div className="marketing">{children ?? <Outlet />}</div>
);

export default MarketingShell;
