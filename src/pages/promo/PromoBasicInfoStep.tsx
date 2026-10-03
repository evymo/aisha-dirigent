import { useTranslation } from "react-i18next";
import { User, Mail, Lock } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateOfBirthPicker } from "@/components/ui/date-of-birth-picker";
import { RatingButtons } from "@/components/ui/rating-buttons";

import type { PromoFormData } from "./promoOnboardingSchemas";

// =============================================================================
// Step 1: Basic Info
// =============================================================================

interface PromoBasicInfoStepProps {
  form: UseFormReturn<PromoFormData>;
  invitedEmail?: string | null;
  isLoggedIn: boolean;
  requirePassword: boolean;
}

export function PromoBasicInfoStep({
  form,
  invitedEmail,
  isLoggedIn,
  requirePassword,
}: PromoBasicInfoStepProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          {t("promo.steps.basicInfo")}
        </CardTitle>
        <CardDescription>
          {t("promo.basicInfo.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Email */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.email")} *</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    className="pl-10"
                    placeholder={t("promo.form.placeholders.email")}
                    disabled={isLoggedIn || !!invitedEmail}
                    {...field}
                  />
                </div>
              </FormControl>
              {invitedEmail && (
                <FormDescription className="text-xs">
                  {t("promo.form.emailLocked")}
                </FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Name fields */}
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("promo.form.firstName")} *</FormLabel>
                <FormControl>
                  <Input placeholder={t("promo.form.placeholders.firstName")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("promo.form.lastName")} *</FormLabel>
                <FormControl>
                  <Input placeholder={t("promo.form.placeholders.lastName")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Date of Birth */}
        <FormField
          control={form.control}
          name="dateOfBirth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.dateOfBirth")} *</FormLabel>
              <FormControl>
                <DateOfBirthPicker
                  value={field.value}
                  onChange={field.onChange}
                  fromYear={1920}
                  toYear={new Date().getFullYear()}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Gender */}
        <FormField
          control={form.control}
          name="gender"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("study.form.gender")}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("common.select")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="male">{t("study.form.genderMale")}</SelectItem>
                  <SelectItem value="female">{t("study.form.genderFemale")}</SelectItem>
                  <SelectItem value="other">{t("study.form.genderNonBinary")}</SelectItem>
                  <SelectItem value="prefer_not_to_say">{t("study.form.genderPreferNotToSay")}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator className="my-4" />

        {/* Touch-friendly wellness ratings */}
        <div className="space-y-6">
          <p className="text-sm font-medium text-muted-foreground">
            {t("promo.wellness.title")}
          </p>

          <FormField
            control={form.control}
            name="physicalState"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">{t("promo.wellness.physical")}</FormLabel>
                <FormDescription>
                  {t("promo.wellness.physicalDesc")}
                </FormDescription>
                <FormControl>
                  <RatingButtons
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={10}
                    labels={{
                      low: t("promo.wellness.low"),
                      high: t("promo.wellness.high"),
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="energyLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base">{t("promo.wellness.energy")}</FormLabel>
                <FormDescription>
                  {t("promo.wellness.energyDesc")}
                </FormDescription>
                <FormControl>
                  <RatingButtons
                    value={field.value}
                    onChange={field.onChange}
                    min={1}
                    max={10}
                    labels={{
                      low: t("promo.wellness.energyLow"),
                      high: t("promo.wellness.energyHigh"),
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Password fields - shown when password is required */}
        {requirePassword && (
          <>
            <Separator className="my-4" />
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {t("promo.form.passwordSection")}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("promo.form.passwordDescription")}
              </p>

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("promo.form.password")} *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="password"
                          className="pl-10"
                          placeholder={t("promo.form.placeholders.password")}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription className="text-xs">
                      {t("promo.form.passwordHint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("promo.form.confirmPassword")} *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="password"
                          className="pl-10"
                          placeholder={t("promo.form.placeholders.confirmPassword")}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </>
        )}

        {/* Info notice based on user state */}
        {!isLoggedIn && !requirePassword && (
          <div className="bg-muted/50 rounded-lg p-4 mt-4">
            <p className="text-sm text-muted-foreground">
              {t("promo.form.emailVerificationNotice")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
