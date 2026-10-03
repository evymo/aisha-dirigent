import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSecureMode } from '@/hooks/useSecureMode';
import { useSession } from '@/hooks/useSession';
import { useHasPassword } from '@/hooks/useHasPassword';
import { useRequestPasswordChange } from '@/hooks/useRequestPasswordChange';
import { Lock, Mail, KeyRound, Loader2, CheckCircle } from 'lucide-react';

export function RequireSecureMode({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { isEnabled, isEnabling, enableWithPassword, requestEmailOtp, verifyEmailOtp, disable, otpRequestedAt } = useSecureMode();
  const { hasPassword, isLoading: isLoadingPassword } = useHasPassword();
  const { requestPasswordChange, isLoading: isRequestingPasswordChange, isSuccess: passwordChangeRequested } = useRequestPasswordChange();

  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [otpToken, setOtpToken] = useState('');
  const [otpInfoMessage, setOtpInfoMessage] = useState<string | null>(null);

  const canUsePassword = useMemo(() => Boolean(user?.email), [user?.email]);

  const onUnlock = async () => {
    if (isEnabling) return;
    setErrorMessage(null);
    setOtpInfoMessage(null);

    const result = await enableWithPassword(password);
    if (result.ok === false) {
      setErrorMessage(result.message);
      return;
    }

    setPassword('');
  };

  const onRequestOtp = async () => {
    if (isEnabling) return;
    setErrorMessage(null);
    setOtpInfoMessage(null);

    const result = await requestEmailOtp();
    if (result.ok === false) {
      setErrorMessage(result.message);
      return;
    }

    setOtpInfoMessage(t('phiMode.otpSent'));
  };

  const onVerifyOtp = async () => {
    if (isEnabling) return;
    setErrorMessage(null);
    setOtpInfoMessage(null);

    const result = await verifyEmailOtp(otpToken);
    if (result.ok === false) {
      setErrorMessage(result.message);
      return;
    }

    setOtpToken('');
  };

  if (isEnabled) return <>{children}</>;

  // Loading state while checking password
  if (isLoadingPassword) {
    return (
      <div className="container max-w-2xl mx-auto px-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If user has no password set, show option to set password via email or use OTP
  if (!hasPassword && canUsePassword) {
    return (
      <div className="container max-w-2xl mx-auto px-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {t('phiMode.passwordRequired')}
            </CardTitle>
            <CardDescription>{t('phiMode.passwordRequiredDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                {t('phiMode.mustSetPasswordOrUseOtp')}
              </AlertDescription>
            </Alert>

            {/* Success message after requesting password change */}
            {passwordChangeRequested && (
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  {t('phiMode.passwordEmailSent')}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3">
              {/* Option 1: Set password via email */}
              <Button
                onClick={() => requestPasswordChange()}
                disabled={isRequestingPasswordChange || passwordChangeRequested}
                className="w-full"
              >
                {isRequestingPasswordChange ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('common.processing')}
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    {t('phiMode.setPasswordViaEmail')}
                  </>
                )}
              </Button>

              {/* Option 2: Use OTP for this session (doesn't set password permanently) */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t('common.or')}</span>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={onRequestOtp}
                disabled={isEnabling}
                className="w-full"
              >
                <Mail className="h-4 w-4 mr-2" />
                {t('phiMode.useOtpInstead')}
              </Button>

              {/* OTP verification if requested */}
              {otpRequestedAt && (
                <div className="space-y-3 p-4 border rounded-lg">
                  {otpInfoMessage && (
                    <Alert>
                      <AlertDescription>{otpInfoMessage}</AlertDescription>
                    </Alert>
                  )}
                  {errorMessage && (
                    <Alert variant="destructive">
                      <AlertDescription>{errorMessage}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="secure-otp-inline">{t('phiMode.otpLabel')}</Label>
                    <Input
                      id="secure-otp-inline"
                      value={otpToken}
                      onChange={(e) => setOtpToken(e.target.value)}
                      placeholder={t('phiMode.otpPlaceholder')}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      onKeyDown={(e) => e.key === 'Enter' && otpToken && onVerifyOtp()}
                    />
                  </div>
                  <Button onClick={onVerifyOtp} disabled={!otpToken || isEnabling} className="w-full">
                    {isEnabling ? t('common.processing') : t('phiMode.verifyOtp')}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Magic Link users without password should see OTP tab first for better UX
  const defaultTab = hasPassword ? 'password' : 'otp';

  return (
    <div className="container max-w-2xl mx-auto px-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('phiMode.title')}</CardTitle>
          <CardDescription>{t('phiMode.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canUsePassword ? (
            <Alert>
              <AlertDescription>{t('phiMode.unsupported')}</AlertDescription>
            </Alert>
          ) : (
            <Tabs defaultValue={defaultTab} className="w-full">
              {/* Show info banner for Magic Link users without password */}
              {!hasPassword && (
                <Alert className="mb-4">
                  <Mail className="h-4 w-4" />
                  <AlertDescription>
                    {t('phiMode.magicLinkUserInfo')}
                  </AlertDescription>
                </Alert>
              )}
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  {t('phiMode.passwordLabel')}
                </TabsTrigger>
                <TabsTrigger value="otp" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t('phiMode.otpLabel')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="password" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="secure-password">{t('phiMode.passwordLabel')}</Label>
                  <Input
                    id="secure-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('phiMode.passwordPlaceholder')}
                    autoComplete="current-password"
                    onKeyDown={(e) => e.key === 'Enter' && password && onUnlock()}
                  />
                </div>

                {errorMessage ? (
                  <Alert variant="destructive">
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex gap-2">
                  <Button onClick={onUnlock} disabled={!password || isEnabling}>
                    {isEnabling ? t('common.processing') : t('phiMode.unlock')}
                  </Button>
                  <Button variant="outline" onClick={disable}>
                    {t('phiMode.cancel')}
                  </Button>
                </div>

                <p className="text-sm text-muted-foreground">
                  {t('phiMode.noPasswordHint')}
                </p>
              </TabsContent>

              <TabsContent value="otp" className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground">
                  {t('phiMode.otpDescription')}
                </p>

                {otpInfoMessage ? (
                  <Alert>
                    <AlertDescription>{otpInfoMessage}</AlertDescription>
                  </Alert>
                ) : null}

                {errorMessage ? (
                  <Alert variant="destructive">
                    <AlertDescription>{errorMessage}</AlertDescription>
                  </Alert>
                ) : null}

                <Button
                  variant="secondary"
                  onClick={onRequestOtp}
                  disabled={isEnabling}
                  className="w-full"
                >
                  {isEnabling ? t('common.processing') : t('phiMode.sendOtp')}
                </Button>

                <div className="space-y-2">
                  <Label htmlFor="secure-otp">{t('phiMode.otpLabel')}</Label>
                  <Input
                    id="secure-otp"
                    value={otpToken}
                    onChange={(e) => setOtpToken(e.target.value)}
                    placeholder={t('phiMode.otpPlaceholder')}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    disabled={!otpRequestedAt}
                    onKeyDown={(e) => e.key === 'Enter' && otpToken && otpRequestedAt && onVerifyOtp()}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={onVerifyOtp}
                    disabled={!otpRequestedAt || !otpToken || isEnabling}
                  >
                    {isEnabling ? t('common.processing') : t('phiMode.verifyOtp')}
                  </Button>
                  <Button variant="outline" onClick={disable}>
                    {t('phiMode.cancel')}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
