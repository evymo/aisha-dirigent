import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/hooks/useSession";

export type StoryLoopBookmarkThreadType = "story" | "discussion";

export interface StoryLoopBookmark {
  id: string;
  threadType: StoryLoopBookmarkThreadType;
  threadId: string;
  entryId: string;
  threadTitle: string;
  entryPreview: string | null;
  createdAt: string;
}

interface ToggleStoryLoopBookmarkInput {
  threadType: StoryLoopBookmarkThreadType;
  threadId: string;
  entryId: string;
  threadTitle: string;
  entryPreview?: string | null;
}

const STORAGE_VERSION = "v1";
const BOOKMARKS_UPDATED_EVENT = "storyloop-bookmarks-updated";

const getStorageKey = (userId: string | undefined): string =>
  `storyloop.bookmarks.${STORAGE_VERSION}.${userId ?? "anon"}`;

const isStoryLoopBookmark = (value: unknown): value is StoryLoopBookmark => {
  if (typeof value !== "object" || value === null) return false;
  const bookmark = value as Record<string, unknown>;
  const threadType = bookmark.threadType;

  return (
    typeof bookmark.id === "string" &&
    (threadType === "story" || threadType === "discussion") &&
    typeof bookmark.threadId === "string" &&
    typeof bookmark.entryId === "string" &&
    typeof bookmark.threadTitle === "string" &&
    (bookmark.entryPreview === null || typeof bookmark.entryPreview === "string") &&
    typeof bookmark.createdAt === "string"
  );
};

const readBookmarks = (storageKey: string): StoryLoopBookmark[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoryLoopBookmark);
  } catch {
    return [];
  }
};

const writeBookmarks = (storageKey: string, bookmarks: StoryLoopBookmark[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(bookmarks));
  } catch {
    // Ignore write failures caused by storage limits.
  }
};

const notifyBookmarksUpdated = (storageKey: string): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ storageKey: string }>(BOOKMARKS_UPDATED_EVENT, {
      detail: { storageKey },
    })
  );
};

/**
 * Local StoryLoop bookmarks for quick return to a specific post in a thread.
 */
export function useStoryLoopBookmarks() {
  const { user } = useSession();
  const storageKey = useMemo(() => getStorageKey(user?.id), [user?.id]);
  const [bookmarks, setBookmarks] = useState<StoryLoopBookmark[]>(() =>
    readBookmarks(storageKey)
  );

  useEffect(() => {
    setBookmarks(readBookmarks(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncBookmarks = () => {
      setBookmarks(readBookmarks(storageKey));
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      syncBookmarks();
    };

    const onBookmarksUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ storageKey: string }>;
      if (customEvent.detail?.storageKey !== storageKey) return;
      syncBookmarks();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(BOOKMARKS_UPDATED_EVENT, onBookmarksUpdated as EventListener);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(BOOKMARKS_UPDATED_EVENT, onBookmarksUpdated as EventListener);
    };
  }, [storageKey]);

  const isBookmarked = useCallback(
    (threadType: StoryLoopBookmarkThreadType, threadId: string, entryId: string): boolean =>
      bookmarks.some(
        (bookmark) =>
          bookmark.threadType === threadType &&
          bookmark.threadId === threadId &&
          bookmark.entryId === entryId
      ),
    [bookmarks]
  );

  const toggleBookmark = useCallback((input: ToggleStoryLoopBookmarkInput): void => {
    const bookmarkId = `${input.threadType}:${input.threadId}:${input.entryId}`;
    setBookmarks((previous) => {
      const exists = previous.some((bookmark) => bookmark.id === bookmarkId);
      if (exists) {
        const nextBookmarks = previous.filter((bookmark) => bookmark.id !== bookmarkId);
        writeBookmarks(storageKey, nextBookmarks);
        notifyBookmarksUpdated(storageKey);
        return nextBookmarks;
      }
      const nextBookmarks = [
        {
          id: bookmarkId,
          threadType: input.threadType,
          threadId: input.threadId,
          entryId: input.entryId,
          threadTitle: input.threadTitle,
          entryPreview: input.entryPreview ?? null,
          createdAt: new Date().toISOString(),
        },
        ...previous,
      ];
      writeBookmarks(storageKey, nextBookmarks);
      notifyBookmarksUpdated(storageKey);
      return nextBookmarks;
    });
  }, [storageKey]);

  const removeBookmark = useCallback((bookmarkId: string): void => {
    setBookmarks((previous) => {
      const nextBookmarks = previous.filter((bookmark) => bookmark.id !== bookmarkId);
      writeBookmarks(storageKey, nextBookmarks);
      notifyBookmarksUpdated(storageKey);
      return nextBookmarks;
    });
  }, [storageKey]);

  return {
    bookmarks,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
  };
}
