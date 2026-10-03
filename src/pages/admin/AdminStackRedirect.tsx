/**
 * AdminStackRedirect — `/admin/stack` shortcut.
 *
 * Resolves the singleton stack-default story id via useStackDefaultStoryId
 * (which calls ensure_stack_default_story on first hit) and redirects to
 * `/admin/stories/<id>`. Stack admins land here for "configure the stack"
 * UX; the underlying surface is AdminStoryDetail with all five tabs.
 */
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useStackDefaultStoryId } from "@/hooks/useEnsureStackDefaultStory";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AdminStackRedirect() {
  const { t } = useTranslation();
  const { data: storyId, isLoading, error } = useStackDefaultStoryId();

  if (isLoading) {
    return (
      <div className="space-y-2 p-6" data-test="admin-stack-redirect-loading">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" data-test="admin-stack-redirect-error">
        <Alert variant="destructive">
          <AlertDescription>
            {t(
              "storyDetail.stackRedirectError",
              "Failed to resolve the stack-default story id: {{message}}",
              { message: (error as Error).message },
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!storyId) {
    return (
      <div className="p-6" data-test="admin-stack-redirect-empty">
        <Alert>
          <AlertDescription>
            {t(
              "storyDetail.stackRedirectEmpty",
              "ensure_stack_default_story returned no id; check service permissions.",
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <Navigate to={`/admin/stories/${storyId}`} replace />;
}
