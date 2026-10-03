import { useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useIsMountedRef } from "@/hooks/useIsMountedRef";
import { useSession } from "@/hooks/useSession";
import { login as oidcLogin } from "@/integrations/auth";
import type { OAuthProvider } from "@/integrations/auth";
import { clearStoredAuthReturnPath, getStoredAuthReturnPath } from "@/hooks/useAuthReturnTracker";
import { safeError } from "@/lib/security/safeLogger";

const INVALID_REDIRECT_PREFIXES = ["/auth", "/set-password", "/change-password"];

function isSafeInternalPath(path?: string | null): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

function sanitizeRedirectPath(path?: string | null) {
  if (!isSafeInternalPath(path)) return null;
  if (INVALID_REDIRECT_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  return path;
}

function shouldUseRoleDefault(path?: string | null) {
  return !path || path === "/" || path === "";
}

function withLangParam(path: string, lang: string) {
  const [pathAndSearch, hash] = path.split("#");
  const [pathname, search = ""] = pathAndSearch.split("?");
  const params = new URLSearchParams(search);
  if (!params.has("lang")) {
    params.set("lang", lang);
  }
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${hash ? `#${hash}` : ""}`;
}

function getDefaultRolePath(hasRole: (role: string) => boolean, roles: string[]) {
  if (hasRole("admin") || hasRole("staff")) return "/admin";
  if (hasRole("partner") || hasRole("practitioner")) return "/partner";
  if (hasRole("evaluator")) return "/member";
  if (roles.length === 0) return "/member";
  return "/member";
}

/**
 * Auth page — Keycloak OIDC login gateway.
 *
 * If the user is already authenticated the page redirects to the appropriate
 * post-auth target. Otherwise it shows provider buttons that trigger the KC
 * authorization-code + PKCE flow via oidc-client-ts.
 */
export default function Auth() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMountedRef = useIsMountedRef();
  const didPostAuthRedirectRef = useRef(false);
  const session = useSession();
  const { user, isLoading: sessionLoading, hasRole, roles } = session;

  const roleDefaultPath = useMemo(
    () => getDefaultRolePath(hasRole, roles),
    [hasRole, roles]
  );

  const postAuthRedirectPath = useMemo(() => {
    // Priority 1: location.state.from (from RequireAuth or manual redirect)
    const state = location.state as { from?: { pathname?: unknown; search?: unknown; hash?: unknown }; returnTo?: string } | null;
    const from = state?.from;

    if (from) {
      const pathname = typeof from.pathname === "string" ? from.pathname : "";
      const search = typeof from.search === "string" ? from.search : "";
      const hash = typeof from.hash === "string" ? from.hash : "";
      const combined = `${pathname}${search}${hash}`;
      
      // Only allow internal paths
      const sanitized = sanitizeRedirectPath(combined);
      if (sanitized) return sanitized;
    }

    // Priority 2: state.returnTo (simple string path)
    const returnTo = sanitizeRedirectPath(state?.returnTo);
    if (returnTo) return returnTo;

    // Priority 3: query param ?redirect= (legacy support)
    const searchParams = new URLSearchParams(location.search);
    const redirectParam = sanitizeRedirectPath(searchParams.get("redirect"));
    if (redirectParam) return redirectParam;

    // Priority 4: stored return path from last non-auth route
    const storedReturn = sanitizeRedirectPath(getStoredAuthReturnPath());
    if (storedReturn) return storedReturn;

    // Fallback to home
    return "/";
  }, [location.state, location.search]);

  const doPostAuthRedirect = useCallback(() => {
    if (didPostAuthRedirectRef.current) return;
    didPostAuthRedirectRef.current = true;
    const targetPath = shouldUseRoleDefault(postAuthRedirectPath)
      ? withLangParam(roleDefaultPath, i18n.language)
      : postAuthRedirectPath;
    clearStoredAuthReturnPath();
    navigate(targetPath, { replace: true });
  }, [navigate, postAuthRedirectPath, roleDefaultPath, i18n.language]);

  // Redirect if already logged in
  useEffect(() => {
    if (!user || !isMountedRef.current) return;

    if (shouldUseRoleDefault(postAuthRedirectPath) && sessionLoading) {
      return;
    }

    doPostAuthRedirect();
  }, [user, doPostAuthRedirect, isMountedRef, postAuthRedirectPath, sessionLoading]);

  /** Redirect to Keycloak with an optional Identity Provider hint. */
  const handleLogin = useCallback(
    async (idpHint?: OAuthProvider) => {
      try {
        await oidcLogin({ idpHint, returnPath: postAuthRedirectPath });
      } catch (error) {
        safeError("auth.login.redirect", error);
      }
    },
    [postAuthRedirectPath],
  );

  // While session is loading show a spinner
  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <section className="pt-32 pb-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-md mx-auto">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("auth.backToHome")}
            </Link>

            <div className="bg-card border border-border rounded-lg p-8">
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="font-serif text-3xl font-bold text-foreground mb-2">
                  {t("auth.welcomeBack")}
                </h1>
                <p className="text-muted-foreground">
                  {t("auth.magicLink.description")}
                </p>
              </div>

              {/* Login buttons — all go through Keycloak */}
              <div className="space-y-3">
                <Button className="w-full" onClick={() => handleLogin()}>
                  {t("auth.signIn")}
                </Button>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      {t("auth.oauth.divider")}
                    </span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleLogin("apple")}
                >
                  {t("auth.oauth.apple")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleLogin("google")}
                >
                  {t("auth.oauth.google")}
                </Button>
              </div>

              {/* Info */}
              <div className="mt-6 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground text-center">
                  {t("auth.secureInfo")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

