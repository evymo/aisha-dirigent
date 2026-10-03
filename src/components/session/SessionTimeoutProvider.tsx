import { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { SessionTimeoutWarning } from './SessionTimeoutWarning';
import { useSignOut } from '@/hooks/useAuthActions';

interface SessionTimeoutProviderProps {
  children: ReactNode;
  timeoutMinutes?: number;
  warningMinutes?: number;
}

export function SessionTimeoutProvider({ 
  children, 
  timeoutMinutes = 30, 
  warningMinutes = 5 
}: SessionTimeoutProviderProps) {
  // Use useAuth directly to avoid circular dependency with SessionProvider
  const { user } = useAuth();
  const signOutMutation = useSignOut();
  
  const { showWarning, remainingSeconds, extendSession } = useSessionTimeout({
    timeoutMinutes,
    warningMinutes,
    enabled: Boolean(user),
  });

  const handleLogout = async () => {
    await signOutMutation.mutateAsync();
  };

  if (!user) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <SessionTimeoutWarning
        open={showWarning}
        remainingSeconds={remainingSeconds}
        onExtend={extendSession}
        onLogout={handleLogout}
      />
    </>
  );
}
