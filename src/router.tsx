import { lazy } from "react";
import { createBrowserRouter, createRoutesFromElements, Route, Navigate } from "react-router-dom";
import { PageLoader } from "@/components/layout/PageLoader";
import { RootLayout } from "@/components/layout/RootLayout";
import { MarketingShell } from "@/components/layout/MarketingShell";
import { RequireAuth } from "@/components/session/RequireAuth";
import { RequirePermission } from "@/components/session/RequirePermission";
import { RequirePasswordChange } from "@/components/security/RequirePasswordChange";
import { EditorPageGate } from "@/components/web/EditorPageGate";
import { HostnamePrimaryRouteRedirect } from "@/components/branding/HostnamePrimaryRouteRedirect";

// ============================================
// LAZY LOADED PAGES - Critical for bundle size
// ============================================

// Public pages (high priority)
const Index = lazy(() => import("./pages/public").then((m) => ({ default: m.Index })));
const Story = lazy(() => import("./pages/Story"));
const Whitepaper = lazy(() => import("./pages/public").then((m) => ({ default: m.Whitepaper })));
const Partners = lazy(() => import("./pages/public").then((m) => ({ default: m.Partners })));
const Research = lazy(() => import("./pages/public").then((m) => ({ default: m.Research })));
const FAQ = lazy(() => import("./pages/public").then((m) => ({ default: m.FAQ })));
const RTNProtocol = lazy(() => import("./pages/public").then((m) => ({ default: m.RTNProtocol })));
const WebPage = lazy(() => import("./components/web/WebPageShell"));
const AdminPages = lazy(() => import("./pages/admin/AdminPages"));
const AdminPageEditor = lazy(() => import("./pages/admin/AdminPageEditor"));
const Onboarding = lazy(() => import("./pages/Onboarding"));

const Archive = lazy(() => import("./pages/Archive"));
const ArchiveDocument = lazy(() => import("./pages/ArchiveDocument"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const KnowledgeTopic = lazy(() => import("./pages/KnowledgeTopic"));
const News = lazy(() => import("./pages/News"));
const NewsArticleDetail = lazy(() => import("./pages/NewsArticleDetail"));

const History = lazy(() => import("./pages/History"));
const ArchiveProvenance = lazy(() => import("./pages/ArchiveProvenance"));
const ArchiveMethods = lazy(() => import("./pages/ArchiveMethods"));
const PromoOnboarding = lazy(() => import("./pages/PromoOnboarding"));

// Lovable web marketing pages
const SolutionPage = lazy(() => import("./pages/SolutionPage"));
const ReferencesPage = lazy(() => import("./pages/ReferencesPage"));
const PartnersPage = lazy(() => import("./pages/PartnersPage"));

// Guild of Experts
const GuildDirectory = lazy(() => import("./pages/GuildDirectory"));
const GuildMemberProfile = lazy(() => import("./pages/GuildMemberProfile"));
const ExpertRules = lazy(() => import("./pages/ExpertRules"));
const ExpertRuleDetail = lazy(() => import("./pages/ExpertRuleDetail"));
const MyRuleSubscriptions = lazy(() => import("./pages/member/MyRuleSubscriptions"));
const AgentMarketplace = lazy(() => import("./pages/AgentMarketplace"));
const AgentMarketplaceDetail = lazy(() => import("./pages/AgentMarketplaceDetail"));
const MyContributedRules = lazy(() => import("./pages/partner/MyContributedRules"));
const ContributeRule = lazy(() => import("./pages/partner/ContributeRule"));
const MyContributedAgents = lazy(() => import("./pages/partner/MyContributedAgents"));
const ContributeAgent = lazy(() => import("./pages/partner/ContributeAgent"));

const Studies = lazy(() => import("./pages/studies/index").then((m) => ({ default: m.Studies })));
const StudyDetail = lazy(() => import("./pages/studies/index").then((m) => ({ default: m.StudyDetail })));

// Product pages
const Shop = lazy(() => import("./pages/Shop"));
const ProductPage = lazy(() => import("./pages/shop/ProductPage"));
const ProductThemingTest = lazy(() => import("./pages/ProductThemingTest"));

// Auth pages
const Auth = lazy(() => import("./pages/Auth"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const SilentRenew = lazy(() => import("./pages/SilentRenew"));
const SetPassword = lazy(() => import("./pages/SetPassword"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Forbidden = lazy(() => import("./pages/Forbidden"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SecretTerminal = lazy(() => import("./pages/SecretTerminal"));

// Legal pages
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const LegalDisclaimer = lazy(() => import("./pages/LegalDisclaimer"));
const AccountDeletion = lazy(() => import("./pages/AccountDeletion"));
const GettingStarted = lazy(() => import("./pages/GettingStarted"));

const Checkout = lazy(() => import("./pages/Checkout"));
const BankTransferConfirmation = lazy(() => import("./pages/BankTransferConfirmation"));

// Member pages
const MemberPortal = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberPortal })));
const MemberCheckIn = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberCheckIn })));
const MemberProfile = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberProfile })));
const MemberOrders = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberOrders })));
const MemberTokens = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberTokens })));
const MemberGovernance = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberGovernance })));
const MemberRewardShop = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberRewardShop })));
const MemberMyVouchers = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberMyVouchers })));
const MemberAppointments = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberAppointments })));
const MemberQuestionnaires = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberQuestionnaires })));
const Leaderboard = lazy(() => import("./pages/member").then((m) => ({ default: m.Leaderboard })));
const MemberAssessment = lazy(() => import("./pages/member/OperationalAssessmentPage"));
// MemberDiary removed — redirects to /member/story
const MemberCalendar = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberCalendar })));
const MemberConsents = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberConsents })));
const MemberStudyConsents = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberStudyConsents })));
const MemberTracking = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberTracking })));
const MemberDosing = lazy(() => import("./pages/member").then((m) => ({ default: m.MemberDosing })));
const MemberStory = lazy(() => import("./pages/member/MemberStory"));
const LongevityScorePage = lazy(() => import("./pages/member/LongevityScorePage"));

// Partner pages
const PartnerDashboard = lazy(() => import("./pages/partner").then((m) => ({ default: m.PartnerDashboard })));
const PartnerUsers = lazy(() => import("./pages/partner").then((m) => ({ default: m.PartnerUsers })));
const PartnerProfile = lazy(() => import("./pages/partner").then((m) => ({ default: m.PartnerProfile })));
const PartnerProfileEdit = lazy(() => import("./pages/partner").then((m) => ({ default: m.PartnerProfileEdit })));
const StoryLoop = lazy(() => import("./pages/partner").then((m) => ({ default: m.StoryLoop })));
const PartnerTemplates = lazy(() => import("./pages/partner").then((m) => ({ default: m.PartnerTemplates })));

// Study Registration Flow
const StudyRegistration = lazy(() => import("./pages/registration").then((m) => ({ default: m.StudyRegistration })));
const QualificationTest = lazy(() => import("./pages/registration").then((m) => ({ default: m.QualificationTest })));
const InformedConsent = lazy(() => import("./pages/registration").then((m) => ({ default: m.InformedConsent })));
const PartnerCertification = lazy(() => import("./pages/partner").then((m) => ({ default: m.PartnerCertification })));

// Admin pages
const AdminLayout = lazy(() => import("./components/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminAuditJournal = lazy(() => import("./pages/admin/AdminAuditJournal"));
const AdminSessionMonitoring = lazy(() => import("./pages/admin/AdminSessionMonitoring"));
const AdminStoryLoop = lazy(() => import("./pages/admin/AdminStoryLoop"));
const AdminStories = lazy(() => import("./pages/admin/AdminStories"));
const AdminStoryDetail = lazy(() => import("./pages/admin/AdminStoryDetail"));
const AdminStackRedirect = lazy(() => import("./pages/admin/AdminStackRedirect"));
const MissionControlKanban = lazy(() => import("./pages/admin/MissionControlKanban"));
const MissionControl = lazy(() => import("./pages/admin/MissionControl"));

const AdminMembers = lazy(() => import("./pages/admin/AdminMembers"));
const AdminDevices = lazy(() => import("./pages/admin/AdminDevices"));
const AdminPartners = lazy(() => import("./pages/admin/AdminPartners"));
const AdminConsultants = lazy(() => import("./pages/admin/AdminConsultants"));
const AdminInvitations = lazy(() => import("./pages/admin/Invitations"));
const AdminRoles = lazy(() => import("./pages/admin/AdminRoles"));
const AdminLideUcty = lazy(() => import("./pages/admin/AdminLideUcty"));
const AdminPermissions = lazy(() => import("./pages/admin/AdminPermissions"));

const AdminStudies = lazy(() => import("./pages/admin/AdminStudies"));
const AdminRegistrations = lazy(() => import("./pages/admin/AdminRegistrations"));
const AdminRegistrationDetail = lazy(() => import("./pages/admin/AdminRegistrationDetail"));
const AdminContributions = lazy(() => import("./pages/admin/AdminContributions"));
const AdminOutcomes = lazy(() => import("./pages/admin/AdminOutcomes"));
const AdminBiomarkerRanges = lazy(() => import("./pages/admin/AdminBiomarkerRanges"));
const AdminProduction = lazy(() => import("./pages/admin/AdminProduction"));
const AdminContextProfiles = lazy(() => import("./pages/admin/AdminContextProfiles"));
const AdminAiRuns = lazy(() => import("./pages/admin/AdminAiRuns"));
const AdminFlowboard = lazy(() => import("./pages/admin/AdminFlowboard"));
const AdminAiRunDetail = lazy(() => import("./pages/admin/AdminAiRunDetail"));
const AdminMcpTokens = lazy(() => import("./pages/admin/AdminMcpTokens"));
const AdminAiObservability = lazy(() => import("./pages/admin/AdminAiObservability"));
const AdminWarmupWizard = lazy(() => import("./pages/admin/AdminWarmupWizard"));

const AdminAiEvaluation = lazy(() => import("./pages/admin/AdminAiEvaluation"));
const AdminAiProactive = lazy(() => import("./pages/admin/AdminAiProactive"));
const AdminModerationSessions = lazy(() => import("./pages/admin/AdminModerationSessions"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminStudyConsents = lazy(() => import("./pages/admin/AdminStudyConsents"));

const AdminProducts = lazy(() => import("./pages/admin/AdminProducts"));
const AdminArchive = lazy(() => import("./pages/admin/AdminArchive"));
const AdminQuestionnaires = lazy(() => import("./pages/admin/AdminQuestionnaires"));
const AdminTestQuestions = lazy(() => import("./pages/admin/AdminTestQuestions"));
const AdminTranslations = lazy(() => import("./pages/admin/AdminTranslations"));

const AdminSubscriptionPackages = lazy(() => import("./pages/admin/AdminSubscriptionPackages"));
const AdminMemberSubscriptions = lazy(() => import("./pages/admin/AdminMemberSubscriptions"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders"));
const AdminTokenomics = lazy(() => import("./pages/admin/AdminTokenomics"));
const AdminPayments = lazy(() => import("./pages/admin/AdminPayments"));
const AdminShipments = lazy(() => import("./pages/admin/AdminShipments"));
const AdminBankReconciliation = lazy(() => import("./pages/admin/AdminBankReconciliation"));
const AdminDistribution = lazy(() => import("./pages/admin/AdminDistribution"));
const AdminDistributionProtocols = lazy(() => import("./pages/admin/AdminDistributionProtocols"));
const AdminDistributionForecast = lazy(() => import("./pages/admin/AdminDistributionForecast"));
const AdminExpeditionCalendar = lazy(() => import("./pages/admin/AdminExpeditionCalendar"));
const AdminDistributionAdjustments = lazy(() => import("./pages/admin/AdminDistributionAdjustments"));
const AdminHeroSlides = lazy(() => import("./pages/admin/AdminHeroSlides"));
const AdminFeaturedProducts = lazy(() => import("./pages/admin/AdminFeaturedProducts"));
const AdminNotifications = lazy(() => import("./pages/admin/AdminNotifications"));
const AdminSymptomCatalog = lazy(() => import("./pages/admin/AdminSymptomCatalog"));
const AdminProductCatalog = lazy(() => import("./pages/admin/AdminProductCatalog"));
const AdminKnowledgeTopics = lazy(() => import("./pages/admin/AdminKnowledgeTopics"));
const AdminKnowledgeModeration = lazy(() => import("./pages/admin/AdminKnowledgeModeration"));
const AdminDeletionRequests = lazy(() => import("./pages/admin/AdminDeletionRequests"));
const AdminNewsArticles = lazy(() => import("./pages/admin/AdminNewsArticles"));
const AdminNewsArticleEditor = lazy(() => import("./pages/admin/AdminNewsArticleEditor"));
const AdminRagnarokKB = lazy(() => import("./pages/admin/AdminRagnarokKB"));
const AdminModelRegistry = lazy(() => import("./pages/admin/AdminModelRegistry"));
const AdminProviderRegistry = lazy(() => import("./pages/admin/AdminProviderRegistry"));
const AdminRuntimeRegistry = lazy(() => import("./pages/admin/AdminRuntimeRegistry"));
const AdminMcpServerRegistry = lazy(() => import("./pages/admin/AdminMcpServerRegistry"));
const AdminPublicChat = lazy(() => import("./pages/admin/AdminPublicChat"));

import { queryClient } from "@/lib/reactQuery/client";
import { publicStatsQueryOptions } from "@/hooks/usePublicStats";
import { heroSlidesQueryOptions } from "@/hooks/useHeroSlides";
import { partnersQueryOptions } from "@/hooks/usePartners";
import { extendedStudiesQueryOptions, studyDetailQueryOptions } from "@/hooks/useStudyFunding";
import { productsQueryOptions, productQueryOptions } from "@/hooks/useProducts";
import { archiveDocumentsQueryOptions, archiveDocumentQueryOptions, archiveFilterOptionsQueryOptions } from "@/hooks/useArchiveDocuments";
import { knowledgeTopicsQueryOptions, knowledgeTopicDetailQueryOptions } from "@/hooks/useKnowledgeBase";
import { guildMembersQueryOptions, expertiseAreasQueryOptions } from "@/hooks/useGuild";
import { expertRulesQueryOptions, expertRuleDetailQueryOptions } from "@/hooks/useExpertRules";
import { availableAgentsQueryOptions } from "@/hooks/useAvailableAgents";
import i18n from "@/i18n";
import { safeError } from "@/lib/security/safeLogger";
import { getTranslationLocale } from "@/lib/i18n/locale";

import { currencyRatesQueryOptions, commerceBaseCurrencyQueryOptions } from "@/hooks/useCurrency";
import { supportedLanguagesQueryOptions } from "@/hooks/useSupportedLanguages";

export const router = createBrowserRouter(
    createRoutesFromElements(
        <Route
            element={<RootLayout />}
            hydrateFallbackElement={<PageLoader />}
            loader={async () => {
                try {
                    // Prefetch critical global data in parallel
                    // We don't await the result because we don't want to block the UI render
                    // but we want the requests to start immediately
                    const promises = [
                        queryClient.ensureQueryData(currencyRatesQueryOptions(getTranslationLocale(i18n.language))),
                        queryClient.ensureQueryData(commerceBaseCurrencyQueryOptions()),
                        queryClient.ensureQueryData(supportedLanguagesQueryOptions(true)),
                        queryClient.ensureQueryData(archiveFilterOptionsQueryOptions()),
                        queryClient.ensureQueryData(publicStatsQueryOptions()),
                        // Prefetch hero slides as early as possible — LCP depends on this data (image URL)
                        queryClient.ensureQueryData(heroSlidesQueryOptions(getTranslationLocale(i18n.language))),
                    ];

                    // We can await Promise.allSettled to not block on errors, 
                    // or just let them run in background.
                    // If we return, the router waits. If we don't await, it continues.
                    // For "critical" data that causes reflows if missing, waiting might be better 
                    // BUT for perceived performance (FCP), non-blocking is better.
                    // Given the goal is "improve render time", we should probably NOT block 
                    // but simple trigger them.

                    // However, ensureQueryData will just return the promise.
                    // If we await it, we delay the route transition.
                    // The user complained about "waterfall". Parallelizing them here helps.
                    // Let's fire them and not await, so they are "in flight" when components mount.
                    promises.forEach(p => p.catch(e => safeError("Root.loader.prefetch", e)));

                    return null;
                } catch (err) {
                    safeError("Root.loader", err);
                    return null;
                }
            }}
        >
            {/* Public Routes */}
            <Route
                path="/"
                element={
                    <HostnamePrimaryRouteRedirect>
                        <MarketingShell><EditorPageGate slug="index"><Index /></EditorPageGate></MarketingShell>
                    </HostnamePrimaryRouteRedirect>
                }
                loader={async () => {
                    try {
                        // Prefetch data in parallel with route chunk loading
                        // We use ensureQueryData to get data or fetch if stale
                        return await queryClient.ensureQueryData(publicStatsQueryOptions());
                    } catch (err) {
                        safeError("Index.loader", err);
                        return null; // Don't crash route if stats fail (optional enhancement)
                    }
                }}
            />
            {/* Lovable marketing pages */}
            <Route path="/solution" element={<MarketingShell><EditorPageGate slug="solution"><SolutionPage /></EditorPageGate></MarketingShell>} />
            <Route path="/references" element={<MarketingShell><EditorPageGate slug="references"><ReferencesPage /></EditorPageGate></MarketingShell>} />

// Chunk 1: Archive and ArchiveDocument
            <Route
                path="/archive"
                element={<Archive />}
                loader={async ({ request }) => {
                    const url = new URL(request.url);
                    const decade = url.searchParams.get("decade") || null;
                    const type = url.searchParams.get("type") || null;
                    const prep = url.searchParams.get("prep") || null;
                    const q = url.searchParams.get("q") || undefined;
                    const tags = url.searchParams.getAll("tag");

                    const filters = {
                        decade,
                        documentType: type,
                        preparation: prep,
                        searchQuery: q,
                        keywords: tags.length > 0 ? tags : null
                    };

                    try {
                        return await queryClient.ensureQueryData(archiveDocumentsQueryOptions(filters));
                    } catch (err) {
                        safeError("Archive.loader", err);
                        return null;
                    }
                }}
            />
            <Route path="/history" element={<History />} />
            <Route path="/archive/provenance" element={<ArchiveProvenance />} />
            <Route path="/archive/methods" element={<ArchiveMethods />} />
            <Route
                path="/archive/:slug"
                element={<ArchiveDocument />}
                loader={async ({ params }) => {
                    if (!params.slug) return null;
                    try {
                        return await queryClient.ensureQueryData(archiveDocumentQueryOptions(params.slug!, getTranslationLocale(i18n.language)));
                    } catch (err) {
                        safeError("ArchiveDocument.loader", err);
                        return null;
                    }
                }}
            />

            {/* Knowledge Base Routes */}
            <Route
                path="knowledge"
                element={
                    <MarketingShell>
                        <EditorPageGate slug="knowledge">
                            <Knowledge />
                        </EditorPageGate>
                    </MarketingShell>
                }
                loader={async ({ request }) => {
                    try {
                        const url = new URL(request.url);
                        const rawVisibility = url.searchParams.get("visibility");
                        const visibility =
                            rawVisibility === "public" || rawVisibility === "members" || rawVisibility === "archived"
                                ? rawVisibility
                                : undefined;
                        const search = url.searchParams.get("q") || undefined;

                        return await queryClient.ensureQueryData(knowledgeTopicsQueryOptions({
                            locale: getTranslationLocale(i18n.language),
                            visibility,
                            search
                        }));
                    } catch (err) {
                        safeError("Knowledge.loader", err);
                        return null;
                    }
                }}
            />
            <Route
                path="knowledge/:slug"
                element={<KnowledgeTopic />}
                loader={async ({ params }) => {
                    try {
                        // Prefetch topic detail
                        const locale = getTranslationLocale(i18n.language);
                        return await queryClient.ensureQueryData(knowledgeTopicDetailQueryOptions(params.slug!, locale));
                    } catch (err) {
                        safeError("KnowledgeTopic.loader", err);
                        return null;
                    }
                }}
            />

            <Route path="/story" element={<MarketingShell><EditorPageGate slug="story"><Story /></EditorPageGate></MarketingShell>} />
            <Route path="/whitepaper" element={<MarketingShell><EditorPageGate slug="whitepaper"><Whitepaper /></EditorPageGate></MarketingShell>} />
            <Route
                path="/shop"
                element={
                    <MarketingShell>
                        <EditorPageGate slug="shop">
                            <Shop />
                        </EditorPageGate>
                    </MarketingShell>
                }
                loader={async () => {
                    try {
                        return await queryClient.ensureQueryData(productsQueryOptions());
                    } catch (err) {
                        safeError("Shop.loader", err);
                        return null;
                    }
                }}
            />
            <Route
                path="/shop/:slug"
                element={<ProductPage />}
                loader={async ({ params }) => {
                    if (!params.slug) return null;
                    try {
                        return await queryClient.ensureQueryData(productQueryOptions(params.slug));
                    } catch (err) {
                        safeError("ProductPage.loader", err);
                        return null;
                    }
                }}
            />
            <Route
                path="/partners"
                element={<MarketingShell><EditorPageGate slug="partners"><PartnersPage /></EditorPageGate></MarketingShell>}
            />
            <Route
                path="/partners/directory"
                element={<MarketingShell><Partners /></MarketingShell>}
                loader={async () => {
                    try {
                        return await queryClient.ensureQueryData(partnersQueryOptions());
                    } catch (err) {
                        safeError("Partners.loader", err);
                        return null;
                    }
                }}
            />
            <Route path="/research" element={<MarketingShell><EditorPageGate slug="research"><Research /></EditorPageGate></MarketingShell>} />
            <Route path="/protocol" element={<MarketingShell><EditorPageGate slug="protocol"><RTNProtocol /></EditorPageGate></MarketingShell>} />
            <Route path="/faq" element={<MarketingShell><EditorPageGate slug="faq"><FAQ /></EditorPageGate></MarketingShell>} />

            {/* Guild of Experts Routes */}
            <Route
                path="/guild"
                element={<GuildDirectory />}
                loader={async () => {
                    try {
                        await Promise.allSettled([
                            queryClient.ensureQueryData(guildMembersQueryOptions({})),
                            queryClient.ensureQueryData(expertiseAreasQueryOptions()),
                        ]);
                        return null;
                    } catch (err) {
                        safeError("Guild.loader", err);
                        return null;
                    }
                }}
            />
            <Route path="/guild/:memberId" element={<GuildMemberProfile />} />
            <Route path="/marketplace" element={<Navigate to="/guild" replace />} />
            <Route
                path="/rules"
                element={<ExpertRules />}
                loader={async () => {
                    try {
                        await Promise.allSettled([
                            queryClient.ensureQueryData(expertRulesQueryOptions({})),
                            queryClient.ensureQueryData(expertiseAreasQueryOptions()),
                        ]);
                        return null;
                    } catch (err) {
                        safeError("ExpertRules.loader", err);
                        return null;
                    }
                }}
            />
            <Route
                path="/rules/:ruleSlug"
                element={<ExpertRuleDetail />}
                loader={async ({ params }) => {
                    if (!params.ruleSlug) return null;
                    try {
                        return await queryClient.ensureQueryData(expertRuleDetailQueryOptions(params.ruleSlug));
                    } catch (err) {
                        safeError("ExpertRuleDetail.loader", err);
                        return null;
                    }
                }}
            />
            {/* Agent Marketplace — browse + install certified-member agents (run-as-story) */}
            <Route
                path="/agents"
                element={<AgentMarketplace />}
                loader={async () => {
                    try {
                        await queryClient.ensureQueryData(availableAgentsQueryOptions());
                        return null;
                    } catch (err) {
                        safeError("AgentMarketplace.loader", err);
                        return null;
                    }
                }}
            />
            <Route
                path="/agents/:agentSlug"
                element={<AgentMarketplaceDetail />}
                loader={async () => {
                    try {
                        await queryClient.ensureQueryData(availableAgentsQueryOptions());
                        return null;
                    } catch (err) {
                        safeError("AgentMarketplaceDetail.loader", err);
                        return null;
                    }
                }}
            />
            <Route path="/news" element={<EditorPageGate slug="news"><News /></EditorPageGate>} />
            {/*
              POZOR: DETAIL PŘES BRÁNU PLÁTNA, jako seznam o řádek výš. Dokud
              stránka plátna se slugem `news-detail` neexistuje, vykreslí se
              dosavadní komponenta — beze změny chování. Jakmile ji redaktor
              v editoru založí a publikuje, převezme ji plátno a detail začne
              nést design webu (útržky, barvy, typografii) jako všechny ostatní
              stránky. Přechod tedy nepotřebuje nasazení; `EditorPageGate` je
              přesně na tohle navržený.

              PROČ TO BYLO POTŘEBA: `/news` branou procházel, `/news/:slug` ne,
              takže detail nesl platformní hlavičku a písmo a design webu na
              něj nedosáhl (naměřeno 2026-08-31 na produkci). Obsah článku
              vykresluje runtime blok `article-detail`.
            */}
            <Route
              path="/news/:slug"
              element={
                <EditorPageGate slug="news-detail">
                  <NewsArticleDetail />
                </EditorPageGate>
              }
            />
            <Route
                path="/studies"
                element={<Studies />}
                loader={async () => {
                    const locale = i18n.language || "en";
                    try {
                        return await queryClient.ensureQueryData(extendedStudiesQueryOptions(locale));
                    } catch (err) {
                        safeError("Studies.loader", err);
                        return null;
                    }
                }}
            />
            <Route
                path="/studies/:id"
                element={<StudyDetail />}
                loader={async ({ params }) => {
                    const locale = i18n.language || "en";
                    if (!params.id) return null;
                    try {
                        return await queryClient.ensureQueryData(studyDetailQueryOptions(params.id, locale));
                    } catch (err) {
                        safeError("StudyDetail.loader", err);
                        return null;
                    }
                }}
            />

            {/* Auth Routes */}
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/silent-renew" element={<SilentRenew />} />
            <Route path="/set-password" element={<SetPassword />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route
                path="/checkout"
                element={
                    <RequirePermission permission="order_products">
                        <Checkout />
                    </RequirePermission>
                }
            />
            <Route
                path="/checkout/bank-transfer/:orderId"
                element={
                    <RequirePermission permission="order_products">
                        <BankTransferConfirmation />
                    </RequirePermission>
                }
            />

            {/* Member Routes */}
            <Route
                path="/member"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberPortal />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/check-in"
                element={
                    <RequirePermission permission="submit_checkins">
                        <MemberCheckIn />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/profile"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberProfile />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/orders"
                element={
                    <RequirePermission permission="order_products">
                        <MemberOrders />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/tokens"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberTokens />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/governance"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberGovernance />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/reward-shop"
                element={
                    <RequireAuth>
                        <MemberRewardShop />
                    </RequireAuth>
                }
            />
            <Route
                path="/member/vouchers"
                element={
                    <RequireAuth>
                        <MemberMyVouchers />
                    </RequireAuth>
                }
            />
            <Route
                path="/member/leaderboard"
                element={
                    <RequireAuth>
                        <Leaderboard />
                    </RequireAuth>
                }
            />
            <Route
                path="/member/appointments"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberAppointments />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/calendar"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberCalendar />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/questionnaires"
                element={
                    <RequireAuth>
                        <MemberQuestionnaires />
                    </RequireAuth>
                }
            />
            <Route
                path="/member/assessment"
                element={
                    <RequirePermission permission="submit_checkins">
                        <MemberAssessment />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/consents"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberConsents />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/study-consents"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberStudyConsents />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/diary"
                element={<Navigate to="/member/story" replace />}
            />
            <Route
                path="/member/health"
                element={<Navigate to="/member/tracking" replace />}
            />
            <Route
                path="/member/tracking"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberTracking />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/dosing"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberDosing />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/story"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberStory />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/story/:storyId"
                element={
                    <RequirePermission permission="view_studies">
                        <MemberStory />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/tracking/longevity"
                element={
                    <RequirePermission permission="view_studies">
                        <LongevityScorePage />
                    </RequirePermission>
                }
            />
            <Route
                path="/member/rules"
                element={
                    <RequireAuth>
                        <MyRuleSubscriptions />
                    </RequireAuth>
                }
            />

            {/* Partner Routes */}
            <Route
                path="/partner"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <Navigate to="/partner/dashboard" replace />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/dashboard"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <PartnerDashboard />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/users"
                element={
                    <RequirePermission permission="view_assigned_members">
                        <PartnerUsers />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/storyloop"
                element={
                    <RequirePermission permission={["view_partner_dashboard", "view_assigned_members", "view_admin_dashboard", "view_staff_dashboard"]}>
                        <StoryLoop />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/storyloop/:storyId"
                element={
                    <RequirePermission permission={["view_partner_dashboard", "view_assigned_members", "view_admin_dashboard", "view_staff_dashboard"]}>
                        <StoryLoop />
                    </RequirePermission>
                }
            />
            {/* Legacy aliases: /partner/story -> /partner/storyloop */}
            <Route
                path="/partner/story"
                element={
                    <RequirePermission permission={["view_partner_dashboard", "view_assigned_members", "view_admin_dashboard", "view_staff_dashboard"]}>
                        <Navigate to="/partner/storyloop" replace />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/story/:storyId"
                element={
                    <RequirePermission permission={["view_partner_dashboard", "view_assigned_members", "view_admin_dashboard", "view_staff_dashboard"]}>
                        <StoryLoop />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/templates"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <PartnerTemplates />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/profile/edit"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <PartnerProfileEdit />
                    </RequirePermission>
                }
            />
            <Route path="/partner/earnings" element={<Navigate to="/partner/dashboard" replace />} />
            <Route
                path="/partner/rules"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <MyContributedRules />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/rules/new"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <ContributeRule />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/rules/:ruleSlug/edit"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <ContributeRule />
                    </RequirePermission>
                }
            />
            {/* Partner agent publishing — author + submit run-as-story agents */}
            <Route
                path="/partner/agents"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <MyContributedAgents />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/agents/new"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <ContributeAgent />
                    </RequirePermission>
                }
            />
            <Route
                path="/partner/agents/:agentSlug/edit"
                element={
                    <RequirePermission permission="view_partner_dashboard">
                        <ContributeAgent />
                    </RequirePermission>
                }
            />
            {/* Public partner profile view - accessible to all authenticated users */}
            <Route
                path="/partner/:partnerId"
                element={
                    <RequireAuth>
                        <PartnerProfile />
                    </RequireAuth>
                }
            />

            {/* Study Registration Flow */}
            <Route path="/invite/:code" element={<Onboarding />} />
            <Route path="/promo" element={<PromoOnboarding />} />
            <Route path="/promo/:code" element={<PromoOnboarding />} />
            <Route path="/study-registration" element={<RequireAuth><StudyRegistration /></RequireAuth>} />
            <Route
                path="/qualification-test"
                element={
                    <RequireAuth>
                        <QualificationTest />
                    </RequireAuth>
                }
            />
            <Route path="/informed-consent" element={<InformedConsent />} />
            <Route
                path="/partner-certification"
                element={
                    <RequireAuth>
                        <PartnerCertification />
                    </RequireAuth>
                }
            />

            {/* Admin Routes */}
            <Route
                path="/admin"
                element={
                    <RequirePermission permission={["view_admin_dashboard", "view_staff_dashboard"]}>
                        <RequirePasswordChange>
                            <AdminLayout />
                        </RequirePasswordChange>
                    </RequirePermission>
                }
            >
                <Route index element={<AdminOverview />} />
                <Route path="members" element={<AdminMembers />} />
                <Route path="devices" element={<AdminDevices />} />
                <Route path="partners" element={<AdminPartners />} />
                <Route path="products" element={<AdminProducts />} />
                <Route path="studies" element={<AdminStudies />} />
                <Route path="registrations" element={<AdminRegistrations />} />
                <Route path="registrations/:id" element={<AdminRegistrationDetail />} />
                <Route path="study-consents" element={<AdminStudyConsents />} />
                <Route path="consultants" element={<AdminConsultants />} />
                <Route path="invitations" element={<AdminInvitations />} />
                <Route path="contributions" element={<AdminContributions />} />
                <Route path="outcomes" element={<AdminOutcomes />} />
                <Route path="archive" element={<AdminArchive />} />
                <Route path="hero-slides" element={<AdminHeroSlides />} />
                <Route path="pages" element={<AdminPages />} />
                <Route path="pages/:id/edit" element={<AdminPageEditor />} />
                <Route path="featured-products" element={<AdminFeaturedProducts />} />
                <Route
                    path="questionnaires"
                    element={<AdminQuestionnaires />}
                />
                <Route path="translations" element={<AdminTranslations />} />
                <Route
                    path="subscriptions"
                    element={<AdminSubscriptionPackages />}
                />
                <Route
                    path="member-subscriptions"
                    element={<AdminMemberSubscriptions />}
                />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="payments" element={<AdminPayments />} />
                <Route path="bank-reconciliation" element={<AdminBankReconciliation />} />
                <Route path="shipments" element={<AdminShipments />} />
                <Route path="distribution" element={<AdminDistribution />} />
                <Route path="distribution-protocols" element={<AdminDistributionProtocols />} />
                <Route path="symptom-catalog" element={<AdminSymptomCatalog />} />
                <Route path="product-catalog" element={<AdminProductCatalog />} />
                <Route path="knowledge/topics" element={<AdminKnowledgeTopics />} />
                <Route path="knowledge/moderation" element={<AdminKnowledgeModeration />} />
                <Route path="distribution-forecast" element={<AdminDistributionForecast />} />
                <Route path="expedition-calendar" element={<AdminExpeditionCalendar />} />
                <Route path="distribution-adjustments" element={<AdminDistributionAdjustments />} />
                <Route path="tests" element={<AdminTestQuestions />} />
                <Route path="roles" element={<AdminRoles />} />
                <Route path="people" element={<AdminLideUcty />} />
                <Route path="biomarkers" element={<AdminBiomarkerRanges />} />
                <Route path="tokenomics" element={<AdminTokenomics />} />
                <Route path="production" element={<AdminProduction />} />
                <Route path="context-profiles" element={<AdminContextProfiles />} />
                <Route path="ai-runs" element={<AdminAiRuns />} />
                <Route path="flowboard" element={<AdminFlowboard />} />
                <Route path="ai-runs/:runId" element={<AdminAiRunDetail />} />
                <Route path="mcp-tokens" element={<AdminMcpTokens />} />
                <Route path="ai-observability" element={<AdminAiObservability />} />
                <Route path="warmup" element={<AdminWarmupWizard />} />

                <Route path="ai-evaluation" element={<AdminAiEvaluation />} />
                <Route path="ai-proactive" element={<AdminAiProactive />} />
                <Route path="moderation" element={<AdminModerationSessions />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="permissions" element={<AdminPermissions />} />
                <Route path="audit-journal" element={<AdminAuditJournal />} />
                <Route
                    path="session-monitoring"
                    element={<AdminSessionMonitoring />}
                />
                <Route path="notifications" element={<AdminNotifications />} />
                <Route path="storyloop" element={<AdminStoryLoop />} />
                <Route path="stories" element={<AdminStories />} />
                <Route path="stories/:id" element={<AdminStoryDetail />} />
                <Route path="stack" element={<AdminStackRedirect />} />
                <Route path="mission-control/kanban" element={<MissionControlKanban />} />
                <Route path="mission-control" element={<MissionControl />} />
                <Route path="deletion-requests" element={<AdminDeletionRequests />} />
                <Route path="news-articles" element={<AdminNewsArticles />} />
                <Route path="news-articles/:id/edit" element={<AdminNewsArticleEditor />} />
                <Route path="ragnarok-kb" element={<AdminRagnarokKB />} />
                <Route path="model-registry" element={<AdminModelRegistry />} />
                <Route path="provider-registry" element={<AdminProviderRegistry />} />
                <Route path="runtime-registry" element={<AdminRuntimeRegistry />} />
                <Route path="mcp-registry" element={<AdminMcpServerRegistry />} />
                <Route path="public-chat" element={<AdminPublicChat />} />
            </Route>

            {/* Legal Routes - Public */}
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            <Route path="/terms" element={<Navigate to="/terms-of-service" replace />} />
            <Route path="/legal-disclaimer" element={<LegalDisclaimer />} />
            <Route path="/disclaimer" element={<Navigate to="/legal-disclaimer" replace />} />

            {/* Getting Started - Public (preview onboarding mini-course) */}
            <Route path="/getting-started" element={<GettingStarted />} />
            <Route path="/jak-zacit" element={<Navigate to="/getting-started" replace />} />

            {/* Account Deletion - Requires Auth */}
            <Route
                path="/account/delete"
                element={
                    <RequireAuth>
                        <AccountDeletion />
                    </RequireAuth>
                }
            />
            <Route path="/remove-account" element={<Navigate to="/account/delete" replace />} />

            {/* Secret Terminal - Easter Egg */}
            <Route path="/terminal" element={<SecretTerminal />} />

            {/* Dynamic web pages from DB (GrapeJS) — before 404 */}
            {/*
              POZOR: `/:slug` POHLTÍ I NEZNÁMÉ ADRESY (naměřeno 2026-09-01 na
              veřejný web instance). Tenhle vzor sedne na KAŽDOU jednosegmentovou
              cestu, takže routa `*` s `<NotFound />` se pro ně nikdy nedostane
              ke slovu. `WebPageShell` přitom vracel `null` v přesvědčení, že
              router zkusí další routu — React Router v6 to nedělá. Výsledek:
              `/cokoliv-neexistuje` = úplně bílá stránka (0 znaků textu),
              zatímco `/aaa/bbb` 404 ukázalo správně.

              Konec cesty se proto říká NAHLAS, ne mlčením.
            */}
            <Route path="/:slug" element={<WebPage kdyzChybi={<NotFound />} />} />

            {/* 404 - Must be last */}
            <Route path="/product-test" element={<ProductThemingTest />} />
            <Route path="/403" element={<Forbidden />} />
            <Route path="*" element={<NotFound />} />
        </Route>
    )
);
