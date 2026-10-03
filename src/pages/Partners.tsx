import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PartnerBookingDialog } from "@/components/partners/PartnerBookingDialog";
import type { PartnerProfile, PartnerProfilePreview } from "@/hooks/usePartners";
import { usePartners } from "@/hooks/usePartners";
import { 
  Building, 
  GraduationCap, 
  Microscope, 
  Users, 
  Mail, 
  Globe,
  FileText,
  Handshake,
  Search,
  MapPin,
  Video,
  User,
  Award,
  Lock,
  LogIn
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const categoryIcons = {
  academic: GraduationCap,
  research: Microscope,
  cultural: Building,
  community: Users
};

const categoryKeys = ["academic", "research", "cultural", "community"] as const;

// Type guard to check if partner has full details
function isFullPartner(partner: PartnerProfile | PartnerProfilePreview): partner is PartnerProfile {
  return 'description' in partner || 'services' in partner;
}

export default function Partners() {
  const { t } = useTranslation();
  const { data: partnersResponse, isLoading } = usePartners();
  
  // Extract data from response
  const partners = partnersResponse?.partners ?? [];
  const isAuthenticated = partnersResponse?.isAuthenticated ?? false;
  const totalCount = partnersResponse?.totalCount;
  const morePartnersAvailable = totalCount !== undefined && totalCount > partners.length;
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<string>("all");
  const [selectedPartner, setSelectedPartner] = useState<PartnerProfile | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);

  // Get unique cities from partners
  const cities = [...new Set(partners.map(p => p.city))].sort();

  // Filter partners (only basic fields available for anonymous users)
  const filteredPartners = partners.filter(partner => {
    const matchesSearch = searchQuery === "" || 
      partner.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (isFullPartner(partner) && partner.business_name?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (isFullPartner(partner) && partner.description?.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCity = selectedCity === "all" || partner.city === selectedCity;
    
    return matchesSearch && matchesCity;
  });

  const handleBookAppointment = (partner: PartnerProfile | PartnerProfilePreview) => {
    if (!isAuthenticated || !isFullPartner(partner)) {
      // Booking is available only for authenticated users with full partner data
      return;
    }
    setSelectedPartner(partner);
    setBookingOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t('partners.sectionLabel')}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t('partners.title')}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t('partners.subtitle')}
            </p>
          </div>
        </div>
      </section>

      {/* Partner Directory */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('partners.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedCity} onValueChange={setSelectedCity}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <MapPin className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t('partners.allCities')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('partners.allCities')}</SelectItem>
                {cities.map((city: string) => (
                  <SelectItem key={city} value={city}>{city}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Sign in banner for anonymous users */}
          {!isAuthenticated && (
            <Alert className="mb-8 border-primary/50 bg-primary/5">
              <Lock className="h-4 w-4" />
              <AlertTitle>{t('partners.signInForMore.title')}</AlertTitle>
              <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-4">
                <span>
                  {morePartnersAvailable 
                    ? t('partners.signInForMore.descriptionWithCount', { count: totalCount })
                    : t('partners.signInForMore.description')
                  }
                </span>
                <Button asChild size="sm" className="w-fit">
                  <Link to="/auth">
                    <LogIn className="mr-2 h-4 w-4" />
                    {t('common.signIn')}
                  </Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Partner Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-3/4" />
                    <div className="h-4 bg-muted rounded w-1/2 mt-2" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-20 bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredPartners.length === 0 ? (
            <div className="text-center py-16">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t('partners.noPartners')}
              </h3>
              <p className="text-muted-foreground mb-6">
                {t('partners.becomeFirst')}
              </p>
              <Button asChild>
                <Link to="/partner-certification">
                  <Award className="mr-2 h-4 w-4" />
                  {t('partners.becomePartner.button')}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPartners.map(partner => {
                const isFull = isFullPartner(partner);
                const canSeeFullDetails = isAuthenticated && isFull;
                return (
                <Card key={partner.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      {canSeeFullDetails ? (
                        <Link to={`/partner/${partner.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            {partner.is_production_provider ? (
                              <Building className="h-6 w-6 text-primary" />
                            ) : (
                              <User className="h-6 w-6 text-primary" />
                            )}
                          </div>
                          <div>
                            <CardTitle className="text-lg">{partner.display_name}</CardTitle>
                            {partner.business_name && (
                              <CardDescription>{partner.business_name}</CardDescription>
                            )}
                          </div>
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            {partner.is_production_provider ? (
                              <Building className="h-6 w-6 text-primary" />
                            ) : (
                              <User className="h-6 w-6 text-primary" />
                            )}
                          </div>
                          <div>
                            <CardTitle className="text-lg">{partner.display_name}</CardTitle>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Badge variant={partner.is_production_provider ? "default" : "secondary"}>
                        {partner.is_production_provider 
                          ? t('partners.badges.provider')
                          : t('partners.badges.partner')
                        }
                      </Badge>
                      {partner.accepts_online_appointments && (
                        <Badge variant="outline" className="gap-1">
                          <Video className="h-3 w-3" />
                          {t('partners.online')}
                        </Badge>
                      )}
                      {partner.accepts_in_person_appointments && (
                        <Badge variant="outline" className="gap-1">
                          <MapPin className="h-3 w-3" />
                          {t('partners.inPerson')}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{partner.city}, {partner.country}</span>
                      </div>
                      
                      {canSeeFullDetails && partner.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {partner.description}
                        </p>
                      )}
                      
                      {canSeeFullDetails && partner.services && partner.services.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {partner.services.slice(0, 3).map(service => (
                            <Badge key={service} variant="outline" className="text-xs">
                              {t(`partnerCertification.services.${service}`)}
                            </Badge>
                          ))}
                          {partner.services.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{partner.services.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}

                      {/* For anonymous users - show sign in prompt instead of actions */}
                      {!canSeeFullDetails && (
                        <div className="pt-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="w-full"
                            asChild
                          >
                            <Link to="/auth">
                              <Lock className="mr-2 h-3 w-3" />
                              {t('partners.signInToViewDetails')}
                            </Link>
                          </Button>
                        </div>
                      )}

                      {/* For authenticated users - show full actions */}
                      {canSeeFullDetails && (
                        <div className="flex gap-2 pt-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="flex-1"
                            asChild
                          >
                            <Link to={`/partner/${partner.id}`}>
                              {t('partners.viewProfile')}
                            </Link>
                          </Button>
                          <Button 
                            size="sm" 
                            className="flex-1"
                            onClick={() => handleBookAppointment(partner)}
                          >
                            {t('partners.bookAppointment')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Become a Partner CTA */}
      <section className="py-16 bg-muted/50 border-y border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto text-center">
            <Award className="h-12 w-12 text-primary mx-auto mb-6" />
            <h2 className="font-serif text-3xl font-bold text-foreground mb-4">
              {t('partners.becomePartner.title')}
            </h2>
            <p className="text-muted-foreground mb-8">
              {t('partners.becomePartner.description')}
            </p>
            <Button size="lg" asChild>
              <Link to="/partner-certification">
                <Award className="mr-2 h-4 w-4" />
                {t('partners.becomePartner.button')}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Partner Categories */}
      <section className="py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl font-bold text-foreground mb-4">
              {t('partners.howWeWork.title')}
            </h2>
            <p className="text-muted-foreground">
              {t('partners.howWeWork.subtitle')}
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {categoryKeys.map((key) => {
              const IconComponent = categoryIcons[key];
              const examplesRaw = t(`partners.categories.${key}.examples`, { returnObjects: true });
              const examples = Array.isArray(examplesRaw) ? examplesRaw : [];
              return (
                <div
                  key={key}
                  className="bg-card border border-border rounded-lg p-8"
                >
                  <IconComponent className="h-10 w-10 text-primary mb-6" />
                  <h3 className="font-serif text-2xl font-bold text-foreground mb-4">
                    {t(`partners.categories.${key}.title`)}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed mb-6">
                    {t(`partners.categories.${key}.description`)}
                  </p>
                  {examples.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-2">{t('common.examples')}:</p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {examples.map((example: string) => (
                          <li key={example}>• {example}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How We Collaborate */}
      <section className="py-24 bg-muted/50 border-y border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <Handshake className="h-12 w-12 text-primary mx-auto mb-6" />
              <h2 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-4">
                {t('partners.howWeWork.title')}
              </h2>
              <p className="text-muted-foreground">
                {t('partners.howWeWork.subtitle')}
              </p>
            </div>

            <div className="space-y-8">
              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Globe className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">{t('partners.howWeWork.openAccess.title')}</h3>
                  <p className="text-muted-foreground">
                    {t('partners.howWeWork.openAccess.description')}
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 bg-secondary/10 rounded-lg flex items-center justify-center">
                  <FileText className="h-6 w-6 text-secondary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">{t('partners.howWeWork.contributions.title')}</h3>
                  <p className="text-muted-foreground">
                    {t('partners.howWeWork.contributions.description')}
                  </p>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="flex-shrink-0 w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                  <Users className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground mb-2">{t('partners.howWeWork.oralHistory.title')}</h3>
                  <p className="text-muted-foreground">
                    {t('partners.howWeWork.oralHistory.description')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="py-24 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <Mail className="h-12 w-12 mx-auto mb-6 opacity-80" />
            <h2 className="font-serif text-3xl sm:text-4xl font-bold mb-6">
              {t('partners.getInTouch.title')}
            </h2>
            <p className="text-lg opacity-90 leading-relaxed mb-8">
              {t('partners.getInTouch.subtitle')}
            </p>
            <Button variant="secondary" size="lg">
              <Mail className="mr-2 h-4 w-4" />
              {t('common.contactUs')}
            </Button>
          </div>
        </div>
      </section>

      <Footer />

      {/* Booking Dialog */}
      {selectedPartner && (
        <PartnerBookingDialog
          partner={selectedPartner}
          open={bookingOpen}
          onOpenChange={setBookingOpen}
        />
      )}
    </div>
  );
}
