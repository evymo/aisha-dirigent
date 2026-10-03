/**
 * Preloads public pages in idle time for instant navigation.
 * Called once from RootLayout after initial render.
 * 
 * Uses dynamic imports with webpackChunkName-style comments
 * to ensure chunks are loaded but not executed until navigation.
 */

let preloaded = false;

export function preloadPublicPages(): void {
    if (preloaded) return;
    preloaded = true;

    // Priority 1: Pages linked from homepage navigation
    const highPriority = [
        () => import("@/pages/public/index"),
        () => import("@/pages/Archive"),
        () => import("@/pages/Story"),
    ];

    // Priority 2: Other public pages
    const lowPriority = [
        () => import("@/pages/studies/index"),
        () => import("@/pages/History"),
        () => import("@/pages/Shop"),
    ];

    // Load high priority first
    Promise.all(highPriority.map(load => load().catch((_preloadErr) => null))).then(() => {
        // Then load lower priority in background
        lowPriority.forEach(load => load().catch((_preloadErr) => null));
    });
}
