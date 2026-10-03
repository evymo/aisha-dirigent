import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, Trophy, User, Save } from "lucide-react";
import { toast } from "sonner";
import { useProfileVisibility, useUpdateProfileVisibility } from "@/hooks/useLeaderboard";

const privacySchema = z.object({
  nickname: z.string().max(50).optional(),
  isPublicProfile: z.boolean(),
  showInLeaderboard: z.boolean(),
});

type PrivacyFormData = z.infer<typeof privacySchema>;

interface PrivacySettingsProps {
  className?: string;
}

export function PrivacySettings({ className }: PrivacySettingsProps) {
  const { t } = useTranslation();
  const { data: visibility, isLoading } = useProfileVisibility();
  const { mutate: updateVisibility, isPending: isSaving } = useUpdateProfileVisibility();

  const form = useForm<PrivacyFormData>({
    resolver: zodResolver(privacySchema),
    defaultValues: {
      nickname: "",
      isPublicProfile: false,
      showInLeaderboard: false,
    },
  });

  useEffect(() => {
    if (visibility) {
      form.reset({
        nickname: visibility.nickname || "",
        isPublicProfile: visibility.isPublicProfile,
        showInLeaderboard: visibility.showInLeaderboard,
      });
    }
  }, [visibility, form]);

  const onSubmit = (data: PrivacyFormData) => {
    updateVisibility(
      {
        nickname: data.nickname || undefined,
        isPublicProfile: data.isPublicProfile,
        showInLeaderboard: data.showInLeaderboard,
      },
      {
        onSuccess: () => {
          toast.success(t("profile.privacy.saved"), {
            description: t("profile.privacy.savedDescription"),
          });
        },
        onError: () => {
          toast.error(t("common.error"), {
            description: t("profile.privacy.saveError"),
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="w-5 h-5" />
          {t("profile.privacy.title")}
        </CardTitle>
        <CardDescription>
          {t("profile.privacy.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="nickname"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {t("profile.privacy.nickname")}
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("profile.privacy.nicknamePlaceholder")}
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormDescription>
                    {t("profile.privacy.nicknameHint")}
                  </FormDescription>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isPublicProfile"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      {t("profile.privacy.isPublic")}
                    </FormLabel>
                    <FormDescription>
                      {t("profile.privacy.isPublicHint")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="showInLeaderboard"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base flex items-center gap-2">
                      <Trophy className="w-4 h-4" />
                      {t("profile.privacy.showInLeaderboard")}
                    </FormLabel>
                    <FormDescription>
                      {t("profile.privacy.showInLeaderboardHint")}
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {visibility && (
              <Alert>
                <AlertDescription className="flex items-center gap-2">
                  <span>{t("profile.privacy.preview")}:</span>
                  <Badge variant="secondary" className="font-medium">
                    {visibility.displayNamePublic}
                  </Badge>
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={isSaving} className="w-full">
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {t("common.save")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
