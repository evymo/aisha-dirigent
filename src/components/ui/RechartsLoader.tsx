import { useEffect, useState } from "react";

type RechartsModule = typeof import("recharts");

interface RechartsLoaderProps {
  children: (recharts: RechartsModule) => React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Loads `recharts` on-demand via dynamic import.
 *
 * Use this for any charts that might be rendered on public/unauthenticated routes,
 * so the `recharts` package cannot accidentally end up in initial/preloaded chunks.
 */
export function RechartsLoader({ children, fallback = null }: RechartsLoaderProps) {
  const [recharts, setRecharts] = useState<RechartsModule | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("recharts").then((mod) => {
      if (!cancelled) setRecharts(mod);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!recharts) return <>{fallback}</>;

  return <>{children(recharts)}</>;
}
