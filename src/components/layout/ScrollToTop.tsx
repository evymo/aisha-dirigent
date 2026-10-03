import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scroll to top on route change.
 * Ensures users start at the top of each page, not at a relative position from the previous page.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
