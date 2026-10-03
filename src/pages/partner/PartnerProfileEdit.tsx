import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useSession } from "@/hooks/useSession";
import { useMyPartnerProfile } from "@/hooks/usePartners";
import { useUpdateMyPartnerProfile } from "@/hooks/useDynamicOnboarding";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import {
  Save,
  Eye,
  EyeOff,
  MapPin,
  Mail,
  Phone,
  Globe,
  Video,
  ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";

const AVAILABLE_SERVICES = [
  "consultation",
  "coaching",
  "therapy",
  "diagnostics",
  "nutrition",
  "training",
  "rehabilitation",
  "prevention",
];

const AVAILABLE_LANGUAGES = [
  "czech",
  "english",
  "german",
  "russian",
  "slovak",
  "polish",
  "french",
  "spanish",
  "italian",
  "chinese",
  "japanese",
  "korean",
  "vietnamese",
];

const profileSchema = z.object({
  display_name: z.string().min(2, "Display name must be at least 2 characters").max(100),
  business_name: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  notes_for_visitors: z.string().max(1000).optional(),
  city: z.string().min(2, "City is required").max(100),
  country: z.string().min(2, "Country is required").max(100),
  address: z.string().max(200).optional(),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  website: z.string().url().max(255).optional().or(z.literal("")),
  services: z.array(z.string()),
  languages: z.array(z.string()),
  is_visible: z.boolean(),
  accepts_online_appointments: z.boolean(),
  accepts_in_person_appointments: z.boolean(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function PartnerProfileEdit() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useSession();
  const { data: partnerProfile, isLoading: profileLoading } = useMyPartnerProfile();
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: "",
      business_name: "",
      description: "",
      notes_for_visitors: "",
      city: "",
      country: "Czech Republic",
      address: "",
      email: "",
      phone: "",
      website: "",
      services: [],
      languages: [],
      is_visible: true,
      accepts_online_appointments: true,
      accepts_in_person_appointments: true,
    },
  });

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!profileLoading && !partnerProfile && user) {
      navigate("/partner-certification");
    }
  }, [partnerProfile, profileLoading, user, navigate]);

  useEffect(() => {
    if (partnerProfile) {
      form.reset({
        display_name: partnerProfile.display_name || "",
        business_name: partnerProfile.business_name || "",
        description: partnerProfile.description || "",
        notes_for_visitors: partnerProfile.notes_for_visitors || "",
        city: partnerProfile.city || "",
        country: partnerProfile.country || "Czech Republic",
        address: partnerProfile.address || "",
        email: partnerProfile.email || "",
        phone: partnerProfile.phone || "",
        website: partnerProfile.website || "",
        services: partnerProfile.services || [],
        languages: partnerProfile.languages || [],
        is_visible: partnerProfile.is_visible,
        accepts_online_appointments: partnerProfile.accepts_online_appointments ?? true,
        accepts_in_person_appointments: partnerProfile.accepts_in_person_appointments ?? true,
      });
    }
  }, [partnerProfile, form]);

  // Mutation hook for updating partner profile
  const updateProfileMutation = useUpdateMyPartnerProfile();

  const onSubmit = async (data: ProfileFormData) => {
    if (!partnerProfile) return;

    setIsSaving(true);
    try {
      await updateProfileMutation.mutateAsync({
        acceptsInPersonAppointments: data.accepts_in_person_appointments,
        acceptsOnlineAppointments: data.accepts_online_appointments,
        address: data.address || undefined,
        businessName: data.business_name || undefined,
        city: data.city,
        country: data.country,
        description: data.description || undefined,
        displayName: data.display_name,
        email: data.email || undefined,
        isVisible: data.is_visible,
        languages: data.languages,
        notesForVisitors: data.notes_for_visitors || undefined,
        phone: data.phone || undefined,
        services: data.services,
        website: data.website || undefined,
      });

      toast.success(t("partnerProfileEdit.saveSuccess"));
    } catch (error) {
      safeError("Error saving profile", error);
      toast.error(t("partnerProfileEdit.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  if (!partnerProfile) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-3xl mx-auto px-4">
          <div className="flex items-center gap-4 mb-8">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/partner/dashboard">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("partnerProfileEdit.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("partnerProfileEdit.subtitle")}
              </p>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Visibility */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {form.watch("is_visible") ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                    {t("partnerProfileEdit.visibility.title")}
                  </CardTitle>
                  <CardDescription>{t("partnerProfileEdit.visibility.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="is_visible"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div>
                          <FormLabel>{t("partnerProfileEdit.visibility.label")}</FormLabel>
                          <FormDescription>{t("partnerProfileEdit.visibility.hint")}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Basic Info */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerProfileEdit.basicInfo.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="display_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.basicInfo.displayName")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="business_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.basicInfo.businessName")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormDescription>{t("partnerProfileEdit.basicInfo.businessNameHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.basicInfo.description")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={4} />
                        </FormControl>
                        <FormDescription>{t("partnerProfileEdit.basicInfo.descriptionHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes_for_visitors"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.basicInfo.notesForVisitors")}</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} />
                        </FormControl>
                        <FormDescription>{t("partnerProfileEdit.basicInfo.notesForVisitorsHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Location */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    {t("partnerProfileEdit.location.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("partnerProfileEdit.location.city")}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("partnerProfileEdit.location.country")}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.location.address")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormDescription>{t("partnerProfileEdit.location.addressHint")}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Contact */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerProfileEdit.contact.title")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.contact.email")}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input {...field} type="email" className="pl-10" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.contact.phone")}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input {...field} className="pl-10" />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("partnerProfileEdit.contact.website")}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input {...field} type="url" className="pl-10" placeholder={t("partnerProfileEdit.contact.websitePlaceholder")} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Services */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerProfileEdit.services.title")}</CardTitle>
                  <CardDescription>{t("partnerProfileEdit.services.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="services"
                    render={({ field }) => (
                      <FormItem>
                        <div className="grid grid-cols-2 gap-3">
                          {AVAILABLE_SERVICES.map((service) => (
                            <div key={service} className="flex items-center space-x-2">
                              <Checkbox
                                id={service}
                                checked={field.value.includes(service)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    field.onChange([...field.value, service]);
                                  } else {
                                    field.onChange(field.value.filter((s) => s !== service));
                                  }
                                }}
                              />
                              <label
                                htmlFor={service}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {t(`partnerCertification.services.${service}`)}
                              </label>
                            </div>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Appointment Types */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerProfileEdit.appointments.title")}</CardTitle>
                  <CardDescription>{t("partnerProfileEdit.appointments.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="accepts_online_appointments"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Video className="h-4 w-4 text-muted-foreground" />
                          <FormLabel className="!mt-0">{t("partnerProfileEdit.appointments.online")}</FormLabel>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="accepts_in_person_appointments"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <FormLabel className="!mt-0">{t("partnerProfileEdit.appointments.inPerson")}</FormLabel>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Languages */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("partnerProfileEdit.languages.title")}</CardTitle>
                  <CardDescription>{t("partnerProfileEdit.languages.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="languages"
                    render={({ field }) => (
                      <FormItem>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {AVAILABLE_LANGUAGES.map((lang) => (
                            <div key={lang} className="flex items-center space-x-2">
                              <Checkbox
                                id={`lang-${lang}`}
                                checked={field.value.includes(lang)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    field.onChange([...field.value, lang]);
                                  } else {
                                    field.onChange(field.value.filter((l) => l !== lang));
                                  }
                                }}
                              />
                              <label
                                htmlFor={`lang-${lang}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {t(`partnerProfileEdit.languages.${lang}`)}
                              </label>
                            </div>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Submit */}
              <div className="flex justify-end gap-4">
                <Button variant="outline" asChild>
                  <Link to="/partner/dashboard">{t("common.cancel")}</Link>
                </Button>
                <Button type="submit" disabled={isSaving}>
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? t("common.saving") : t("common.save")}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </main>

      <Footer />
    </div>
  );
}
