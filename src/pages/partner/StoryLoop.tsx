/**
 * StoryLoop Page
 *
 * Partner workspace – 2-column web-page layout with horizontal filter bar.
 * Desktop: list (24 rem) | detail (1fr), padded container.
 * Mobile : single-column with back-navigation via StoryLoopPageLayout.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import {
  StoryList,
  DiscussionList,
  StoryDetail,
  DiscussionDetail,
  AishaConsultPanel,
  NewStoryDialog,
  AddEntryDialog,
  NewDiscussionDialog,
  StoryLoopFilterBar,
  StoryLoopBookmarkSheet,
  StoryLoopPageLayout,
} from '@/components/storyloop';
import type { StoryLoopThreadMode } from '@/components/storyloop/StoryLoopFilterBar';
import { useStoryDetail } from '@/hooks/useStoryLoop';
import {
  useStoryLoopBookmarks,
  type StoryLoopBookmark,
} from '@/hooks/useStoryLoopBookmarks';
import { usePermissions } from '@/hooks/usePermissions';
import { useSession } from '@/hooks/useSession';
import { useMyPartnerCertification } from '@/hooks/useTestResults';
import { Bot, Bookmark } from 'lucide-react';

export default function StoryLoopPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { hasRole } = useSession();
  const { hasAnyPermission, hasPermission } = usePermissions();
  const { data: partnerCertification } = useMyPartnerCertification();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const requestedStoryId = searchParams.get('story');
  const requestedDiscussionId = searchParams.get('topic');
  const { storyId: urlStoryId } = useParams<{ storyId?: string }>();

  const isPartnerStoryRoute =
    location.pathname.startsWith('/partner/storyloop') ||
    location.pathname.startsWith('/partner/story');
  const isMemberStoryRoute = location.pathname.startsWith('/member/story');
  const canAccessStoryMode = hasAnyPermission(
    'view_studies',
    'view_partner_dashboard',
    'view_assigned_members',
  ) || isMemberStoryRoute;
  const canAccessPartnerStories = hasAnyPermission(
    'view_partner_dashboard',
    'view_assigned_members',
  );
  const canCreateMemberStory = isMemberStoryRoute && hasRole('member');
  const canCreateStory =
    (canAccessPartnerStories && isPartnerStoryRoute) || canCreateMemberStory;
  const canUseAisha =
    hasPermission('view_admin_dashboard') ||
    hasPermission('view_staff_dashboard') ||
    Boolean(partnerCertification?.passed);

  // ── State ─────────────────────────────────────────────────────────
  const [threadMode, setThreadMode] = useState<StoryLoopThreadMode>(() => {
    if (requestedView === 'discussions') return 'discussions';
    if (requestedView !== 'stories' && requestedDiscussionId && !requestedStoryId && !urlStoryId) {
      return 'discussions';
    }
    return 'stories';
  });
  const [selectedStatus, setSelectedStatus] = useState<string | null>(
    searchParams.get('status') || null,
  );
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(
    urlStoryId || requestedStoryId || null,
  );
  const [selectedDiscussionId, setSelectedDiscussionId] = useState<string | null>(
    requestedDiscussionId || null,
  );
  const [isAishaOpen, setIsAishaOpen] = useState(false);
  const [isNewStoryOpen, setIsNewStoryOpen] = useState(false);
  const [isAddEntryOpen, setIsAddEntryOpen] = useState(false);
  const [isNewDiscussionOpen, setIsNewDiscussionOpen] = useState(false);
  const [isBookmarkSheetOpen, setIsBookmarkSheetOpen] = useState(false);

  // ── Data hooks ────────────────────────────────────────────────────
  const { data: storyData } = useStoryDetail(selectedStoryId);
  const { bookmarks, removeBookmark } = useStoryLoopBookmarks();
  const visibleBookmarks = useMemo(
    () =>
      bookmarks.filter((bookmark) =>
        canAccessStoryMode ? true : bookmark.threadType === 'discussion',
      ),
    [bookmarks, canAccessStoryMode],
  );

  // ── URL ⇄ State sync ─────────────────────────────────────────────
  useEffect(() => {
    if (!canAccessStoryMode) {
      setThreadMode('discussions');
      setSelectedStoryId(null);
      if (requestedDiscussionId) {
        setSelectedDiscussionId(requestedDiscussionId);
      }
      return;
    }

    const storyFromUrl = urlStoryId || requestedStoryId;
    if (storyFromUrl) {
      setThreadMode('stories');
      setSelectedStoryId(storyFromUrl);
      setSelectedDiscussionId(null);
      return;
    }

    if (requestedView === 'discussions') {
      setThreadMode('discussions');
      if (requestedDiscussionId) {
        setSelectedDiscussionId(requestedDiscussionId);
      }
      setSelectedStoryId(null);
      return;
    }

    if (requestedView === 'stories') {
      setThreadMode('stories');
      if (requestedStoryId) {
        setSelectedStoryId(requestedStoryId);
      }
      setSelectedDiscussionId(null);
      return;
    }

    if (requestedDiscussionId) {
      setThreadMode('discussions');
      setSelectedDiscussionId(requestedDiscussionId);
      setSelectedStoryId(null);
    }
  }, [
    canAccessStoryMode,
    requestedDiscussionId,
    requestedStoryId,
    requestedView,
    urlStoryId,
  ]);

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', threadMode);

      if (threadMode === 'discussions') {
        next.delete('status');
        next.delete('story');
        if (selectedDiscussionId) {
          next.set('topic', selectedDiscussionId);
        } else {
          next.delete('topic');
          next.delete('post');
        }
      } else if (selectedStatus) {
        next.set('status', selectedStatus);
        next.delete('topic');
        if (selectedStoryId) {
          next.set('story', selectedStoryId);
        } else {
          next.delete('story');
          next.delete('post');
        }
      } else {
        next.delete('status');
        next.delete('topic');
        if (selectedStoryId) {
          next.set('story', selectedStoryId);
        } else {
          next.delete('story');
          next.delete('post');
        }
      }
      return next;
    }, { replace: true });
  }, [
    selectedDiscussionId,
    selectedStatus,
    selectedStoryId,
    setSearchParams,
    threadMode,
  ]);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleStatusChange = useCallback((status: string | null) => {
    setSelectedStatus(status);
  }, []);

  const handleLabelToggle = useCallback((label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label],
    );
  }, []);

  const handleNewStory = useCallback(() => {
    if (!canCreateStory) return;
    setThreadMode('stories');
    setIsNewStoryOpen(true);
  }, [canCreateStory]);

  const handleAddEntry = useCallback(() => {
    setIsAddEntryOpen(true);
  }, []);

  const handleAddEntrySuccess = useCallback((_entryId: string, storyId: string) => {
    setThreadMode('stories');
    setSelectedStoryId(storyId);
    setSelectedDiscussionId(null);
  }, []);

  const handleNewDiscussion = useCallback(() => {
    setIsNewDiscussionOpen(true);
  }, []);

  const handleNewDiscussionSuccess = useCallback((topicId: string) => {
    setThreadMode('discussions');
    setSelectedDiscussionId(topicId);
    setSelectedStoryId(null);
  }, []);

  const handleNewStorySuccess = useCallback((storyId: string) => {
    setThreadMode('stories');
    setSelectedStoryId(storyId);
    setSelectedDiscussionId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('post');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleStorySelect = useCallback((storyId: string) => {
    setThreadMode('stories');
    setSelectedStoryId(storyId);
    setSelectedDiscussionId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('post');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleDiscussionSelect = useCallback((topicId: string) => {
    setThreadMode('discussions');
    setSelectedDiscussionId(topicId);
    setSelectedStoryId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('post');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleThreadModeChange = useCallback((mode: StoryLoopThreadMode) => {
    if (mode === 'stories' && !canAccessStoryMode) return;

    setThreadMode(mode);
    setSearchQuery('');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('post');
      return next;
    }, { replace: true });

    if (mode === 'stories') {
      setSelectedDiscussionId(null);
    } else {
      setSelectedStoryId(null);
      setSelectedLabels([]);
    }
  }, [canAccessStoryMode, setSearchParams]);

  const handleBookmarkSelect = useCallback((bookmark: StoryLoopBookmark) => {
    if (bookmark.threadType === 'story') {
      if (!canAccessStoryMode) return;
      setThreadMode('stories');
      setSelectedStoryId(bookmark.threadId);
      setSelectedDiscussionId(null);
    } else {
      setThreadMode('discussions');
      setSelectedDiscussionId(bookmark.threadId);
      setSelectedStoryId(null);
    }

    setSearchQuery('');
    setIsBookmarkSheetOpen(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', bookmark.threadType === 'story' ? 'stories' : 'discussions');
      if (bookmark.threadType === 'story') {
        next.set('story', bookmark.threadId);
        next.delete('topic');
      } else {
        next.set('topic', bookmark.threadId);
        next.delete('story');
      }
      next.set('post', bookmark.entryId);
      return next;
    }, { replace: true });
  }, [canAccessStoryMode, setSearchParams]);

  const handleBookmarkRemove = useCallback((bookmarkId: string) => {
    removeBookmark(bookmarkId);
  }, [removeBookmark]);

  const handleBackToList = useCallback(() => {
    if (threadMode === 'discussions') {
      setSelectedDiscussionId(null);
    } else {
      setSelectedStoryId(null);
    }
  }, [threadMode]);

  // ── Derived ───────────────────────────────────────────────────────
  const hasDetailSelection =
    threadMode === 'discussions' ? Boolean(selectedDiscussionId) : Boolean(selectedStoryId);
  const isDiscussionMode = threadMode === 'discussions';

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>
      <div className="min-h-screen flex flex-col bg-background">
        <Header />

        <main className="flex-1 pt-[var(--header-height)]">
          <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
            {/* ── Page header ───────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t('storyloop.title')}
              </h1>
              <div className="flex items-center gap-2">
                {visibleBookmarks.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setIsBookmarkSheetOpen(true)}
                  >
                    <Bookmark className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {t('storyloop.bookmarks.title')}
                    </span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setIsAishaOpen(true)}
                  disabled={!selectedStoryId || !canUseAisha}
                >
                  <Bot className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {t('storyloop.aisha.consult')}
                  </span>
                </Button>
              </div>
            </div>

            {/* ── Filter bar ────────────────────────────────────── */}
            <StoryLoopFilterBar
              threadMode={threadMode}
              onThreadModeChange={handleThreadModeChange}
              selectedStatus={selectedStatus}
              onStatusChange={handleStatusChange}
              selectedLabels={selectedLabels}
              onLabelToggle={handleLabelToggle}
              search={searchQuery}
              onSearchChange={setSearchQuery}
              allowStoryMode={canAccessStoryMode}
              storyDataEnabled={canAccessStoryMode && threadMode === 'stories'}
              onNewStory={handleNewStory}
              canCreateStory={canCreateStory}
              onAddEntry={canAccessPartnerStories ? handleAddEntry : undefined}
              onNewDiscussion={handleNewDiscussion}
            />

            {/* ── 2-column list + detail ────────────────────────── */}
            <StoryLoopPageLayout
              hasDetailSelection={hasDetailSelection}
              onBackToList={handleBackToList}
              list={
                isDiscussionMode ? (
                  <DiscussionList
                    search={searchQuery}
                    onSearchChange={setSearchQuery}
                    selectedDiscussionId={selectedDiscussionId}
                    onDiscussionSelect={handleDiscussionSelect}
                    showSearch={false}
                  />
                ) : (
                  <StoryList
                    status={selectedStatus}
                    labels={selectedLabels}
                    search={searchQuery}
                    onSearchChange={setSearchQuery}
                    selectedStoryId={selectedStoryId}
                    onStorySelect={handleStorySelect}
                    enabled={canAccessStoryMode}
                    showSearch={false}
                  />
                )
              }
              detail={
                isDiscussionMode ? (
                  <DiscussionDetail topicId={selectedDiscussionId} standalone />
                ) : (
                  <StoryDetail
                    storyId={selectedStoryId}
                    canOpenAisha={canUseAisha}
                    onOpenAisha={() => setIsAishaOpen(true)}
                    standalone
                  />
                )
              }
            />
          </div>
        </main>

        <Footer />
      </div>

      {/* ── Aisha Consultation Sheet ──────────────────────────────── */}
      <Sheet open={isAishaOpen} onOpenChange={setIsAishaOpen}>
        <SheetContent className="w-full sm:w-[540px] p-0">
          <div className="h-[100dvh] sm:h-[100dvh]">
            {selectedStoryId && storyData ? (
              <AishaConsultPanel
                storyId={selectedStoryId}
                storyTitle={storyData.title}
                userName={storyData.user_display_name}
                embedded
                onClose={() => setIsAishaOpen(false)}
              />
            ) : (
              <div className="h-full flex items-center justify-center p-4">
                <p className="text-sm text-muted-foreground">
                  {t('storyloop.selectStory')}
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Bookmark Sheet ────────────────────────────────────────── */}
      <StoryLoopBookmarkSheet
        open={isBookmarkSheetOpen}
        onOpenChange={setIsBookmarkSheetOpen}
        bookmarks={visibleBookmarks}
        onBookmarkSelect={handleBookmarkSelect}
        onBookmarkRemove={handleBookmarkRemove}
      />

      {/* ── New Story Dialog ──────────────────────────────────────── */}
      <NewStoryDialog
        open={isNewStoryOpen}
        onOpenChange={setIsNewStoryOpen}
        onSuccess={handleNewStorySuccess}
        memberSelfMode={canCreateMemberStory}
      />

      {/* ── Add Entry Dialog ──────────────────────────────────────── */}
      <AddEntryDialog
        open={isAddEntryOpen}
        onOpenChange={setIsAddEntryOpen}
        onSuccess={handleAddEntrySuccess}
      />

      {/* ── New Discussion Dialog ─────────────────────────────────── */}
      <NewDiscussionDialog
        open={isNewDiscussionOpen}
        onOpenChange={setIsNewDiscussionOpen}
        onSuccess={handleNewDiscussionSuccess}
      />
    </>
  );
}
