import { useState, useEffect, lazy, Suspense } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { 
  Menu, X, Archive, ShoppingBag, Users,
  Sparkles, Newspaper
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CartSheet } from "@/components/cart/CartSheet";
import { useSession } from "@/hooks/useSession";
import { useCart } from "@/hooks/useCart";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CurrencySwitcher } from "@/components/CurrencySwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isUsingAishaDevFallback } from "@/integrations/db/runtimeFlags";
import { useBrowserNotificationBridge } from "@/hooks/useBrowserNotificationBridge";
import { useWebPushSubscription } from "@/hooks/useWebPushSubscription";
import { useBrand } from "@/components/branding/useBrand";

// Lazy load auth-dependent components to reduce initial bundle for anonymous visitors
const HeaderUserSection = lazy(() => 
  import("./HeaderUserSection").then(m => ({ default: m.HeaderUserSection }))
);
const MobileUserSection = lazy(() => 
  import("./HeaderUserSection").then(m => ({ default: m.MobileUserSection }))
);
const NotificationCenter = lazy(() => 
  import("@/components/notifications/NotificationCenter").then(m => ({ default: m.NotificationCenter }))
);

// Simple loading placeholder for user avatar
function UserAvatarSkeleton() {
  return (
    <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
  );
}

export function Header() {
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { user } = useSession();
  const { itemCount } = useCart();
  const isAuthenticated = !!user;
  // Read brand from context (populated by BrandingThemeProvider). Fall back
  // to legacy "AISHA / Dirigent by Evymo" when no brand has resolved — this
  // keeps the build-time default identical to behaviour before the wiring.
  const brand = useBrand();
  const brandName = brand?.operator_name ?? "AISHA";

  useBrowserNotificationBridge();
  useWebPushSubscription({
    enabled: isAuthenticated,
    autoSync: true,
    autoSubscribeWhenGranted: true,
  });

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const navLinks = [
    { name: t('web.nav.solution'), href: "/solution", icon: Sparkles },
    { name: t('web.nav.guild'), href: "/guild", icon: Users },
    { name: t('web.nav.references'), href: "/references", icon: Archive },
    { name: t('web.nav.about'), href: "/story", icon: Newspaper },
  ];

  return (
    <>
    <header className="fixed top-0 left-0 right-0 z-50 max-w-[100vw] overflow-x-clip bg-background/85 backdrop-blur-xl border-b border-border/40 shadow-sm supports-[backdrop-filter]:bg-background/70">
      <nav className="container mx-auto px-2 sm:px-6 lg:px-8">
        <div className="flex h-18 items-center justify-between">
          {/* Logo - More lifestyle feel */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary opacity-80 group-hover:opacity-100 transition-opacity" />
                <span className="font-serif text-2xl font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                  {brandName}
                </span>
                {isUsingAishaDevFallback && (
                  <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-[0.18em] bg-secondary/20 border-secondary text-foreground">
                    {t('header.devBackend')}
                  </Badge>
                )}
              </div>
              {/* Tagline is only shown when no tenant brand has resolved.
                  Once a tenant brand applies, the tagline becomes noise
                  (e.g. a tenant brand may not want "Dirigent by Evymo" under its
                  logo). When/if a `brand_tagline` column is added to
                  branding_profiles, render it from there. */}
              {!brand && (
                <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground ml-7">
                  Dirigent by Evymo
                </span>
              )}
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium rounded-full transition-all duration-200",
                  location.pathname.startsWith(link.href)
                    ? "text-primary bg-primary/10"
                    : "text-foreground/70 hover:text-foreground hover:bg-muted/50"
                )}
              >
                {link.name}
              </Link>
            ))}
          </div>

          {/* Desktop CTA & Auth */}
          <div className="hidden md:flex md:items-center gap-3">
            <Button variant="default" size="sm" asChild className="rounded-full px-5 bg-gold hover:bg-gold-dark text-navy font-semibold text-xs tracking-wide">
              <Link to="/partners">{t('web.nav.partnerProgram')}</Link>
            </Button>
            <LanguageSwitcher />
            <CurrencySwitcher />
            <ThemeToggle />
            
            {isAuthenticated && (
              <Suspense fallback={null}>
                <NotificationCenter />
              </Suspense>
            )}
            
            <CartSheet>
              <Button variant="ghost" size="icon" className="relative rounded-full hover:bg-primary/10" aria-label={t('header.openCart')}>
                <ShoppingBag className="h-5 w-5" />
                {itemCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-secondary text-secondary-foreground text-xs flex items-center justify-center font-medium">
                    {itemCount}
                  </span>
                )}
              </Button>
            </CartSheet>

            {isAuthenticated && user ? (
              <Suspense fallback={<UserAvatarSkeleton />}>
                <HeaderUserSection user={user} />
              </Suspense>
            ) : (
              <Button variant="default" size="sm" asChild className="rounded-full px-6">
                <Link to="/auth">{t('header.signIn')}</Link>
              </Button>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden items-center gap-0.5 shrink-0">
            <LanguageSwitcher />
            <CurrencySwitcher />
            <ThemeToggle />
            <CartSheet>
              <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={t('header.openCart')}>
                <ShoppingBag className="h-5 w-5" />
                {itemCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-secondary text-secondary-foreground text-xs flex items-center justify-center font-medium">
                    {itemCount}
                  </span>
                )}
              </Button>
            </CartSheet>
            <button
              type="button"
              className="p-2 text-foreground rounded-full hover:bg-muted/50 transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

      </nav>
    </header>

    {/* Mobile Navigation - z-40 sits below the header (z-50) so no gap is visible */}
    {mobileMenuOpen && (
      <div
        className="md:hidden fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/85"
        style={{ paddingTop: 'var(--header-height)' }}
      >
        <div className="flex flex-col gap-1 pt-4 pb-8 px-4 min-h-full">
            {/* Main Navigation Links */}
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3.5 text-base font-medium rounded-xl transition-colors",
                  location.pathname.startsWith(link.href)
                    ? "text-primary bg-primary/10"
                    : "text-foreground/70 hover:text-foreground hover:bg-muted/50"
                )}
                onClick={() => setMobileMenuOpen(false)}
              >
                <link.icon className="h-5 w-5" />
                {link.name}
              </Link>
            ))}

            {/* Managed delivery CTA */}
            <div className="mt-2 px-2">
              <Button variant="default" size="sm" className="w-full rounded-full bg-gold hover:bg-gold-dark text-navy font-semibold" asChild>
                <Link to="/partners" onClick={() => setMobileMenuOpen(false)}>
                  {t('web.nav.partnerProgram')}
                </Link>
              </Button>
            </div>

            {/* Authenticated User Section */}
            {isAuthenticated && user ? (
              <Suspense fallback={
                <div className="mt-4 pt-4 border-t border-border/50 px-2">
                  <div className="flex items-center gap-3 px-2">
                    <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                      <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                </div>
              }>
                <div className="mt-4 pt-4 border-t border-border/50">
                  <MobileUserSection 
                    user={user} 
                    onNavigate={() => setMobileMenuOpen(false)} 
                  />
                </div>
              </Suspense>
            ) : (
              <div className="mt-4 pt-4 border-t border-border/50 px-2">
                <Button variant="default" size="sm" className="w-full rounded-full" asChild>
                  <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>
                    {t('header.signIn')}
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
