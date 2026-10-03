/**
 * Utility functions for formatting names with privacy considerations.
 * Mirrors the database function format_display_name_for_public.
 */

/**
 * Format a display name for public visibility.
 * - If nickname is set, returns the nickname
 * - If profile is public, returns full display name
 * - Otherwise returns "FirstName L." format (first name + last initial)
 * 
 * @param displayName - Full display name
 * @param nickname - Optional nickname (takes priority)
 * @param isPublic - Whether the profile is public
 * @param fallback - Fallback text for anonymous users (default: "Anonymní")
 * @returns Formatted name suitable for public display
 */
export function formatPublicName(
  displayName: string | null | undefined,
  nickname: string | null | undefined,
  isPublic: boolean,
  fallback = "Anonymní"
): string {
  // If nickname is set, always use it
  if (nickname && nickname.trim()) {
    return nickname.trim();
  }
  
  // If profile is public, return full display name
  if (isPublic) {
    return displayName?.trim() || fallback;
  }
  
  // Otherwise format as "Jméno P."
  if (!displayName || !displayName.trim()) {
    return fallback;
  }
  
  const parts = displayName.trim().split(/\s+/);
  
  if (parts.length === 1) {
    return parts[0];
  }
  
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1][0].toUpperCase() + ".";
  
  return `${firstName} ${lastInitial}`;
}

/**
 * Get initials from a display name (for avatars).
 * 
 * @param displayName - Full display name
 * @returns Initials (up to 2 characters)
 */
export function getInitials(displayName: string | null | undefined): string {
  if (!displayName || !displayName.trim()) {
    return "?";
  }
  
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  
  if (parts.length === 0) {
    return "?";
  }
  
  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }
  
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

