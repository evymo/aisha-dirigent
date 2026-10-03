/**
 * Deep linking hook.
 * Handles the app's URL scheme (from the brand's version.json → app.config
 * `scheme`) and universal links. The scheme is read from the resolved Expo
 * config so a re-skinned build (e.g. tenant-app://) needs no code change here.
 */
import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { captureDeepLinkEvent } from "@/config/sentry";
import { safeError, safeInfo } from "@/lib/security/safeLogger";

/** App URL scheme from the resolved Expo config (config `scheme` may be string | string[]). */
const _scheme = (() => {
  const s = Constants.expoConfig?.scheme;
  return (Array.isArray(s) ? s[0] : s) ?? "";
})();
const _appDomain = process.env.EXPO_PUBLIC_APP_DOMAIN ?? "";
const URL_SCHEMES = [
  ...(_scheme ? [`${_scheme}://`] : []),
  ...(_appDomain ? [`https://${_appDomain}/app/`] : []),
];

interface RouteMapping {
  params?: Record<string, string>;
  path: string;
}

/** Map incoming deep link paths to expo-router paths. */
function resolveRoute(url: string): RouteMapping | null {
  try {
    // Normalize URL — strip scheme
    let path = url;
    for (const scheme of URL_SCHEMES) {
      if (path.startsWith(scheme)) {
        path = path.substring(scheme.length);
        break;
      }
    }

    // Strip query + hash for routing, but keep params
    const queryIdx = path.indexOf("?");
    const hashIdx = path.indexOf("#");
    const cleanPath = path.substring(
      0,
      Math.min(
        queryIdx >= 0 ? queryIdx : path.length,
        hashIdx >= 0 ? hashIdx : path.length
      )
    ).replace(/\/$/, ""); // trim trailing slash

    const params: Record<string, string> = {};
    if (queryIdx >= 0) {
      const searchStr = path.substring(queryIdx + 1, hashIdx >= 0 ? hashIdx : undefined);
      for (const part of searchStr.split("&")) {
        const [key, value] = part.split("=");
        if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
      }
    }

    // Route mapping
    const routes: Record<string, string> = {
      "": "/(tabs)",
      "chat": "/chat",
      "dashboard": "/(tabs)",
      "monitor": "/(tabs)/monitor",
      "naturel": "/naturel-style",
      "oauth-callback": "/(auth)/oauth-callback",
      "porada": "/porada",
      "projects": "/(tabs)/projects",
      "settings": "/settings",
      "validator": "/validator",
    };

    // Direct match
    if (cleanPath in routes) {
      return { params, path: routes[cleanPath] };
    }

    // Dynamic routes
    const projectMatch = cleanPath.match(/^project\/([a-f0-9-]+)$/i);
    if (projectMatch) {
      return { params: { ...params, id: projectMatch[1] }, path: `/project/${projectMatch[1]}` };
    }

    const questionnaireMatch = cleanPath.match(/^questionnaire\/([a-f0-9-]+)$/i);
    if (questionnaireMatch) {
      return {
        params: { ...params, id: questionnaireMatch[1] },
        path: `/questionnaire/${questionnaireMatch[1]}`,
      };
    }

    const conversationsMatch = cleanPath.match(/^conversations$/i);
    if (conversationsMatch) {
      return { params, path: "/conversations" };
    }

    safeInfo("deepLink.unmatched", { path: cleanPath });
    return null;
  } catch (error) {
    safeError("deepLink.resolve", error);
    return null;
  }
}

/** Sanitize URL for logging (remove query + hash). */
function sanitizeUrl(url: string): string {
  const idx = Math.min(
    url.indexOf("?") >= 0 ? url.indexOf("?") : url.length,
    url.indexOf("#") >= 0 ? url.indexOf("#") : url.length
  );
  return url.substring(0, idx);
}

export function useDeepLinking() {
  const initialUrlProcessed = useRef(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    // Handle initial URL (app opened via deep link)
    if (!initialUrlProcessed.current) {
      initialUrlProcessed.current = true;
      Linking.getInitialURL()
        .then((url) => {
          if (url) {
            handleUrl(url);
          }
        })
        .catch((error) => safeError("deepLink.getInitialUrl", error));
    }

    // Handle subsequent deep links while app is running
    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      isMounted.current = false;
      subscription.remove();
    };
  }, []);

  function handleUrl(url: string) {
    safeInfo("deepLink.received", { url: sanitizeUrl(url) });
    captureDeepLinkEvent(url);

    const route = resolveRoute(url);
    if (route) {
      safeInfo("deepLink.navigating", { path: route.path });
      setTimeout(() => {
        if (!isMounted.current) return;
        try {
          if (route.params && Object.keys(route.params).length > 0) {
            router.push({ pathname: route.path as never, params: route.params });
          } else {
            router.push(route.path as never);
          }
        } catch (error) {
          safeError("deepLink.navigate", error);
        }
      }, 0);
    }
  }
}
