import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * Simple redirect component that forwards invitation codes to PromoOnboarding.
 * PromoOnboarding handles the full flow including account creation at the end.
 */
export default function Onboarding() {
  const { code } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (code) {
      // Redirect to PromoOnboarding which handles the complete flow
      // including account creation at the end with magic link
      navigate(`/promo/${code}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
  }, [code, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}
