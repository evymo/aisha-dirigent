import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Loader2, Lock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useMarkPasswordSet } from "@/hooks/useHasPassword";
import { useUpdatePassword, useAuthSession } from "@/hooks/useAuthActions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { safeError } from "@/lib/security/safeLogger";

/**
 * SetPassword - Page for setting password after email verification
 * 
 * Flow:
 * 1. User receives verification email with token
 * 2. Clicks link, lands here with token in URL
 * 3. Sets password
 * 4. Redirects to member portal
 */
export default function SetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const markPasswordSet = useMarkPasswordSet();
  const updatePasswordMutation = useUpdatePassword();
  const { data: session, isLoading: sessionLoading } = useAuthSession();
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});

  // Password validation schema
  const passwordSchema = z.string()
    .min(8, t("validation.passwordMin8"))
    .regex(/[A-Z]/, t("validation.passwordUppercase"))
    .regex(/[a-z]/, t("validation.passwordLowercase"))
    .regex(/[0-9]/, t("validation.passwordNumber"));

  // Verify token on mount
  useEffect(() => {
    if (sessionLoading) return;

    // Check if we have access_token and type=signup in URL
    const accessToken = searchParams.get('access_token');
    const type = searchParams.get('type');
    
    if (!accessToken || type !== 'signup') {
      setIsValid(false);
      toast.error(t("auth.errors.invalidLink"), {
        description: t("auth.errors.linkExpired"),
      });
      return;
    }

    if (!session) {
      setIsValid(false);
      toast.error(t("auth.errors.verificationFailed"), {
        description: t("auth.errors.tryAgain"),
      });
    } else {
      setIsValid(true);
    }
  }, [session, sessionLoading, searchParams, t]);

  const validateForm = () => {
    const newErrors: { password?: string; confirmPassword?: string } = {};
    
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      newErrors.password = passwordResult.error.errors[0].message;
    }
    
    // eslint-disable-next-line security/detect-possible-timing-attacks -- UI confirm-field equality, not a secret comparison
    if (password !== confirmPassword) {
      newErrors.confirmPassword = t("validation.passwordMatch");
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsLoading(true);

    try {
      // Update user password
      await updatePasswordMutation.mutateAsync();

      // Mark password as set in profile (for sensitive data access requirement)
      await markPasswordSet.mutateAsync();

      toast.success(t("auth.success.passwordSet"), {
        description: t("auth.success.passwordSetDesc"),
      });

      // Redirect to member portal
      navigate("/member");
    } catch (error) {
      safeError("SetPassword.handleSubmit", error);
      toast.error(t("auth.errors.passwordSetFailed"), {
        description: t("auth.errors.tryAgain"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("common.verifying")}</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (!isValid) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <section className="pt-32 pb-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-md mx-auto">
              <Card>
                <CardHeader>
                  <CardTitle className="text-destructive">
                    {t("auth.errors.invalidLink")}
                  </CardTitle>
                  <CardDescription>
                    {t("auth.errors.linkExpired")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => navigate("/auth")} className="w-full">
                    {t("auth.backToLogin")}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Valid token - show password form
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <section className="pt-32 pb-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-6 w-6 text-primary" />
                  <CardTitle>{t("auth.setPassword.title")}</CardTitle>
                </div>
                <CardDescription>
                  {t("auth.setPassword.description")}
                </CardDescription>
              </CardHeader>
              
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">
                      {t("auth.password")} *
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setErrors((prev) => ({ ...prev, password: undefined }));
                        }}
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </div>
                    {errors.password && (
                      <p className="text-sm text-destructive">{errors.password}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("auth.setPassword.requirements")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      {t("auth.confirmPassword")} *
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                        }}
                        className="pl-10"
                        disabled={isLoading}
                      />
                    </div>
                    {errors.confirmPassword && (
                      <p className="text-sm text-destructive">{errors.confirmPassword}</p>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("common.processing")}
                      </>
                    ) : (
                      t("auth.setPassword.submit")
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
