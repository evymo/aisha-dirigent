-- ============================================================================
-- STEP 13: Platform KPI Metrics (reference ranges)
-- ============================================================================

INSERT INTO public.biomarker_reference_ranges (
  biomarker_key, category, unit, min_value, max_value,
  optimal_min, optimal_max, critical_low, critical_high,
  name_key, description_key
) VALUES
-- Performance category
('response_time',       'performance', 'ms',   50,  500,  50,  200,  NULL, 1000, 'biomarkers.response_time.name',       'biomarkers.response_time.description'),
('page_load_time',      'performance', 'ms',  100, 3000, 100, 1500,  NULL, 5000, 'biomarkers.page_load_time.name',      'biomarkers.page_load_time.description'),
('api_latency',         'performance', 'ms',   10,  300,  10,  100,  NULL,  800, 'biomarkers.api_latency.name',         'biomarkers.api_latency.description'),
('ttfb',                'performance', 'ms',   50,  800,  50,  400,  NULL, 2000, 'biomarkers.ttfb.name',                'biomarkers.ttfb.description'),
('throughput',          'performance', 'rps', 100, 10000, 500, 5000,    50, NULL, 'biomarkers.throughput.name',          'biomarkers.throughput.description'),
-- Reliability category
('uptime',              'reliability', '%',  99.0, 100.0, 99.9, 100.0, 95.0, NULL, 'biomarkers.uptime.name',              'biomarkers.uptime.description'),
('error_rate',          'reliability', '%',   0.0,   5.0,  0.0,   1.0, NULL,  10.0, 'biomarkers.error_rate.name',          'biomarkers.error_rate.description'),
('crash_rate',          'reliability', '%',   0.0,   2.0,  0.0,   0.5, NULL,   5.0, 'biomarkers.crash_rate.name',          'biomarkers.crash_rate.description'),
('mttr',                'reliability', 'min',  5,  120,   5,   30,  NULL,  480, 'biomarkers.mttr.name',                'biomarkers.mttr.description'),
('mtbf',                'reliability', 'hrs', 24, 8760, 720, 8760,    8, NULL, 'biomarkers.mtbf.name',                'biomarkers.mtbf.description'),
-- Engagement category
('dau',                 'engagement',  'users',  100, 100000, 1000, 50000,   10, NULL, 'biomarkers.dau.name',                 'biomarkers.dau.description'),
('session_duration',    'engagement',  'min',      1,    60,    5,    30, NULL,  120, 'biomarkers.session_duration.name',    'biomarkers.session_duration.description'),
('bounce_rate',         'engagement',  '%',      10,    80,   10,    40, NULL,   95, 'biomarkers.bounce_rate.name',         'biomarkers.bounce_rate.description'),
('retention_7d',        'engagement',  '%',      10,   100,   40,   100,    5, NULL, 'biomarkers.retention_7d.name',        'biomarkers.retention_7d.description'),
('nps_score',           'engagement',  'score',  -100,  100,   30,   100, -50, NULL, 'biomarkers.nps_score.name',           'biomarkers.nps_score.description'),
-- Quality category
('code_coverage',       'quality',     '%',      50,   100,   80,   100,   30, NULL, 'biomarkers.code_coverage.name',       'biomarkers.code_coverage.description'),
('tech_debt_ratio',     'quality',     '%',       0,    30,    0,    10, NULL,   50, 'biomarkers.tech_debt_ratio.name',     'biomarkers.tech_debt_ratio.description'),
('bug_density',         'quality',     '/kloc',   0,    10,    0,     3, NULL,   20, 'biomarkers.bug_density.name',         'biomarkers.bug_density.description'),
('test_pass_rate',      'quality',     '%',      80,   100,   95,   100,   60, NULL, 'biomarkers.test_pass_rate.name',      'biomarkers.test_pass_rate.description'),
-- Business category
('conversion_rate',     'business',    '%',     0.5,   20,    2,    10,  0.1, NULL, 'biomarkers.conversion_rate.name',     'biomarkers.conversion_rate.description'),
('churn_rate',          'business',    '%',     0.5,   15,  0.5,     5, NULL,   25, 'biomarkers.churn_rate.name',          'biomarkers.churn_rate.description'),
('arpu',                'business',    'USD',     5,   500,   20,   200, NULL, NULL, 'biomarkers.arpu.name',                'biomarkers.arpu.description'),
('cac',                 'business',    'USD',     5,   500,    5,   100, NULL, 1000, 'biomarkers.cac.name',                 'biomarkers.cac.description'),
('ltv_cac_ratio',       'business',    'ratio',   1,    10,    3,    10,  0.5, NULL, 'biomarkers.ltv_cac_ratio.name',       'biomarkers.ltv_cac_ratio.description'),
-- Infrastructure category
('cpu_utilization',     'infrastructure', '%',    5,    90,   20,    70, NULL,  95, 'biomarkers.cpu_utilization.name',     'biomarkers.cpu_utilization.description'),
('memory_utilization',  'infrastructure', '%',   10,    90,   30,    75, NULL,  95, 'biomarkers.memory_utilization.name',  'biomarkers.memory_utilization.description'),
('disk_utilization',    'infrastructure', '%',    5,    85,   10,    70, NULL,  95, 'biomarkers.disk_utilization.name',    'biomarkers.disk_utilization.description')
ON CONFLICT (biomarker_key) DO UPDATE SET
  category = EXCLUDED.category,
  unit = EXCLUDED.unit,
  min_value = EXCLUDED.min_value,
  max_value = EXCLUDED.max_value,
  optimal_min = EXCLUDED.optimal_min,
  optimal_max = EXCLUDED.optimal_max,
  critical_low = EXCLUDED.critical_low,
  critical_high = EXCLUDED.critical_high,
  name_key = EXCLUDED.name_key,
  description_key = EXCLUDED.description_key;

-- ============================================================================
-- STEP 13a: Platform KPI Metric Translations (CS + EN)
-- ============================================================================

INSERT INTO public.translations (locale, namespace, key, value) VALUES
-- Performance - CS
('cs', 'biomarkers', 'biomarkers.response_time.name', 'Doba odezvy'),
('cs', 'biomarkers', 'biomarkers.response_time.description', 'Průměrná doba odezvy serveru na požadavky'),
('cs', 'biomarkers', 'biomarkers.page_load_time.name', 'Doba načtení stránky'),
('cs', 'biomarkers', 'biomarkers.page_load_time.description', 'Celková doba načtení stránky včetně všech zdrojů'),
('cs', 'biomarkers', 'biomarkers.api_latency.name', 'Latence API'),
('cs', 'biomarkers', 'biomarkers.api_latency.description', 'Průměrná latence API endpointů'),
('cs', 'biomarkers', 'biomarkers.ttfb.name', 'Time to First Byte'),
('cs', 'biomarkers', 'biomarkers.ttfb.description', 'Doba do prvního bajtu odpovědi ze serveru'),
('cs', 'biomarkers', 'biomarkers.throughput.name', 'Propustnost'),
('cs', 'biomarkers', 'biomarkers.throughput.description', 'Počet zpracovaných požadavků za sekundu'),
-- Reliability - CS
('cs', 'biomarkers', 'biomarkers.uptime.name', 'Dostupnost'),
('cs', 'biomarkers', 'biomarkers.uptime.description', 'Procentuální dostupnost služby'),
('cs', 'biomarkers', 'biomarkers.error_rate.name', 'Chybovost'),
('cs', 'biomarkers', 'biomarkers.error_rate.description', 'Procento požadavků končících chybou'),
('cs', 'biomarkers', 'biomarkers.crash_rate.name', 'Míra pádů'),
('cs', 'biomarkers', 'biomarkers.crash_rate.description', 'Procento relací končících pádem aplikace'),
('cs', 'biomarkers', 'biomarkers.mttr.name', 'Střední doba opravy'),
('cs', 'biomarkers', 'biomarkers.mttr.description', 'Průměrná doba potřebná k opravě výpadku'),
('cs', 'biomarkers', 'biomarkers.mtbf.name', 'Střední doba mezi poruchami'),
('cs', 'biomarkers', 'biomarkers.mtbf.description', 'Průměrný čas mezi dvěma po sobě jdoucími poruchami'),
-- Engagement - CS
('cs', 'biomarkers', 'biomarkers.dau.name', 'Denní aktivní uživatelé'),
('cs', 'biomarkers', 'biomarkers.dau.description', 'Počet unikátních uživatelů za den'),
('cs', 'biomarkers', 'biomarkers.session_duration.name', 'Délka relace'),
('cs', 'biomarkers', 'biomarkers.session_duration.description', 'Průměrná doba jedné uživatelské relace'),
('cs', 'biomarkers', 'biomarkers.bounce_rate.name', 'Míra okamžitého opuštění'),
('cs', 'biomarkers', 'biomarkers.bounce_rate.description', 'Procento návštěvníků, kteří odejdou po první stránce'),
('cs', 'biomarkers', 'biomarkers.retention_7d.name', 'Retence 7 dní'),
('cs', 'biomarkers', 'biomarkers.retention_7d.description', 'Procento uživatelů, kteří se vrátí během 7 dní'),
('cs', 'biomarkers', 'biomarkers.nps_score.name', 'NPS skóre'),
('cs', 'biomarkers', 'biomarkers.nps_score.description', 'Net Promoter Score — ochota doporučit platformu'),
-- Quality - CS
('cs', 'biomarkers', 'biomarkers.code_coverage.name', 'Pokrytí kódu'),
('cs', 'biomarkers', 'biomarkers.code_coverage.description', 'Procento kódu pokryté automatickými testy'),
('cs', 'biomarkers', 'biomarkers.tech_debt_ratio.name', 'Technický dluh'),
('cs', 'biomarkers', 'biomarkers.tech_debt_ratio.description', 'Poměr technického dluhu k celkovému kódu'),
('cs', 'biomarkers', 'biomarkers.bug_density.name', 'Hustota chyb'),
('cs', 'biomarkers', 'biomarkers.bug_density.description', 'Počet chyb na tisíc řádků kódu'),
('cs', 'biomarkers', 'biomarkers.test_pass_rate.name', 'Úspěšnost testů'),
('cs', 'biomarkers', 'biomarkers.test_pass_rate.description', 'Procento úspěšně procházejících testů'),
-- Business - CS
('cs', 'biomarkers', 'biomarkers.conversion_rate.name', 'Konverzní poměr'),
('cs', 'biomarkers', 'biomarkers.conversion_rate.description', 'Procento návštěvníků, kteří provedou cílovou akci'),
('cs', 'biomarkers', 'biomarkers.churn_rate.name', 'Míra odchodu'),
('cs', 'biomarkers', 'biomarkers.churn_rate.description', 'Procento uživatelů, kteří přestanou službu používat'),
('cs', 'biomarkers', 'biomarkers.arpu.name', 'ARPU'),
('cs', 'biomarkers', 'biomarkers.arpu.description', 'Průměrný příjem na uživatele'),
('cs', 'biomarkers', 'biomarkers.cac.name', 'Náklady na akvizici'),
('cs', 'biomarkers', 'biomarkers.cac.description', 'Průměrné náklady na získání jednoho zákazníka'),
('cs', 'biomarkers', 'biomarkers.ltv_cac_ratio.name', 'LTV/CAC poměr'),
('cs', 'biomarkers', 'biomarkers.ltv_cac_ratio.description', 'Poměr celoživotní hodnoty zákazníka k nákladům na jeho získání'),
-- Infrastructure - CS
('cs', 'biomarkers', 'biomarkers.cpu_utilization.name', 'Využití CPU'),
('cs', 'biomarkers', 'biomarkers.cpu_utilization.description', 'Procentuální vytížení procesoru'),
('cs', 'biomarkers', 'biomarkers.memory_utilization.name', 'Využití paměti'),
('cs', 'biomarkers', 'biomarkers.memory_utilization.description', 'Procentuální využití operační paměti'),
('cs', 'biomarkers', 'biomarkers.disk_utilization.name', 'Využití disku'),
('cs', 'biomarkers', 'biomarkers.disk_utilization.description', 'Procentuální využití diskového prostoru'),

-- Performance - EN
('en', 'biomarkers', 'biomarkers.response_time.name', 'Response Time'),
('en', 'biomarkers', 'biomarkers.response_time.description', 'Average server response time for requests'),
('en', 'biomarkers', 'biomarkers.page_load_time.name', 'Page Load Time'),
('en', 'biomarkers', 'biomarkers.page_load_time.description', 'Total page load time including all resources'),
('en', 'biomarkers', 'biomarkers.api_latency.name', 'API Latency'),
('en', 'biomarkers', 'biomarkers.api_latency.description', 'Average latency of API endpoints'),
('en', 'biomarkers', 'biomarkers.ttfb.name', 'Time to First Byte'),
('en', 'biomarkers', 'biomarkers.ttfb.description', 'Time until the first byte of server response'),
('en', 'biomarkers', 'biomarkers.throughput.name', 'Throughput'),
('en', 'biomarkers', 'biomarkers.throughput.description', 'Number of requests processed per second'),
-- Reliability - EN
('en', 'biomarkers', 'biomarkers.uptime.name', 'Uptime'),
('en', 'biomarkers', 'biomarkers.uptime.description', 'Service availability percentage'),
('en', 'biomarkers', 'biomarkers.error_rate.name', 'Error Rate'),
('en', 'biomarkers', 'biomarkers.error_rate.description', 'Percentage of requests resulting in errors'),
('en', 'biomarkers', 'biomarkers.crash_rate.name', 'Crash Rate'),
('en', 'biomarkers', 'biomarkers.crash_rate.description', 'Percentage of sessions ending in application crash'),
('en', 'biomarkers', 'biomarkers.mttr.name', 'Mean Time to Repair'),
('en', 'biomarkers', 'biomarkers.mttr.description', 'Average time required to resolve an outage'),
('en', 'biomarkers', 'biomarkers.mtbf.name', 'Mean Time Between Failures'),
('en', 'biomarkers', 'biomarkers.mtbf.description', 'Average time between two consecutive failures'),
-- Engagement - EN
('en', 'biomarkers', 'biomarkers.dau.name', 'Daily Active Users'),
('en', 'biomarkers', 'biomarkers.dau.description', 'Number of unique users per day'),
('en', 'biomarkers', 'biomarkers.session_duration.name', 'Session Duration'),
('en', 'biomarkers', 'biomarkers.session_duration.description', 'Average duration of a single user session'),
('en', 'biomarkers', 'biomarkers.bounce_rate.name', 'Bounce Rate'),
('en', 'biomarkers', 'biomarkers.bounce_rate.description', 'Percentage of visitors who leave after viewing one page'),
('en', 'biomarkers', 'biomarkers.retention_7d.name', '7-Day Retention'),
('en', 'biomarkers', 'biomarkers.retention_7d.description', 'Percentage of users returning within 7 days'),
('en', 'biomarkers', 'biomarkers.nps_score.name', 'NPS Score'),
('en', 'biomarkers', 'biomarkers.nps_score.description', 'Net Promoter Score — willingness to recommend the platform'),
-- Quality - EN
('en', 'biomarkers', 'biomarkers.code_coverage.name', 'Code Coverage'),
('en', 'biomarkers', 'biomarkers.code_coverage.description', 'Percentage of code covered by automated tests'),
('en', 'biomarkers', 'biomarkers.tech_debt_ratio.name', 'Tech Debt Ratio'),
('en', 'biomarkers', 'biomarkers.tech_debt_ratio.description', 'Ratio of technical debt to total codebase'),
('en', 'biomarkers', 'biomarkers.bug_density.name', 'Bug Density'),
('en', 'biomarkers', 'biomarkers.bug_density.description', 'Number of bugs per thousand lines of code'),
('en', 'biomarkers', 'biomarkers.test_pass_rate.name', 'Test Pass Rate'),
('en', 'biomarkers', 'biomarkers.test_pass_rate.description', 'Percentage of tests passing successfully'),
-- Business - EN
('en', 'biomarkers', 'biomarkers.conversion_rate.name', 'Conversion Rate'),
('en', 'biomarkers', 'biomarkers.conversion_rate.description', 'Percentage of visitors completing a target action'),
('en', 'biomarkers', 'biomarkers.churn_rate.name', 'Churn Rate'),
('en', 'biomarkers', 'biomarkers.churn_rate.description', 'Percentage of users who stop using the service'),
('en', 'biomarkers', 'biomarkers.arpu.name', 'ARPU'),
('en', 'biomarkers', 'biomarkers.arpu.description', 'Average Revenue Per User'),
('en', 'biomarkers', 'biomarkers.cac.name', 'Customer Acquisition Cost'),
('en', 'biomarkers', 'biomarkers.cac.description', 'Average cost of acquiring one customer'),
('en', 'biomarkers', 'biomarkers.ltv_cac_ratio.name', 'LTV/CAC Ratio'),
('en', 'biomarkers', 'biomarkers.ltv_cac_ratio.description', 'Ratio of customer lifetime value to acquisition cost'),
-- Infrastructure - EN
('en', 'biomarkers', 'biomarkers.cpu_utilization.name', 'CPU Utilization'),
('en', 'biomarkers', 'biomarkers.cpu_utilization.description', 'Percentage of CPU capacity in use'),
('en', 'biomarkers', 'biomarkers.memory_utilization.name', 'Memory Utilization'),
('en', 'biomarkers', 'biomarkers.memory_utilization.description', 'Percentage of RAM in use'),
('en', 'biomarkers', 'biomarkers.disk_utilization.name', 'Disk Utilization'),
('en', 'biomarkers', 'biomarkers.disk_utilization.description', 'Percentage of disk space in use')
ON CONFLICT (key, namespace, locale) DO UPDATE SET value = EXCLUDED.value;

-- ============================================================================
-- STEP 13b: Archive Documents — Platform Documentation & Release Notes
-- ============================================================================

INSERT INTO public.archive_documents (
  id, title, slug, document_type, year,
  people, preparation, original_language, storage_path, keywords,
  is_public, created_at
) VALUES
(
  'ad000001-0001-4000-8000-000000000001',
  'Platform Architecture Overview v1.0',
  'platform-architecture-overview-v1',
  'technical_document',
  2024,
  ARRAY['Engineering Team'],
  'Internal documentation of the platform architecture, covering microservices, data flow, and integration points.',
  'en',
  'archive/docs/architecture-overview-v1.pdf',
  ARRAY['architecture', 'microservices', 'data-flow', 'design'],
  true,
  '2024-01-15 10:00:00+00'
),
(
  'ad000001-0001-4000-8000-000000000002',
  'API Reference Guide v2.0',
  'api-reference-guide-v2',
  'technical_document',
  2024,
  ARRAY['API Team', 'Developer Relations'],
  'Comprehensive API documentation covering all public endpoints, authentication, rate limiting, and webhooks.',
  'en',
  'archive/docs/api-reference-v2.pdf',
  ARRAY['api', 'reference', 'endpoints', 'documentation'],
  true,
  '2024-03-20 10:00:00+00'
),
(
  'ad000001-0001-4000-8000-000000000003',
  'Security Audit Report Q1 2025',
  'security-audit-q1-2025',
  'audit_report',
  2025,
  ARRAY['Security Team', 'External Auditor'],
  'Quarterly security audit covering penetration testing, vulnerability assessment, and compliance verification.',
  'en',
  'archive/reports/security-audit-q1-2025.pdf',
  ARRAY['security', 'audit', 'penetration-testing', 'compliance'],
  false,
  '2025-04-01 10:00:00+00'
),
(
  'ad000001-0001-4000-8000-000000000004',
  'Release Notes v3.0 — Major Platform Update',
  'release-notes-v3-major-update',
  'release_notes',
  2025,
  ARRAY['Product Team'],
  'Major release introducing new analytics dashboard, workflow automation engine, and redesigned notification system.',
  'en',
  'archive/releases/release-notes-v3.0.pdf',
  ARRAY['release', 'v3.0', 'analytics', 'workflow', 'notifications'],
  true,
  '2025-06-01 10:00:00+00'
),
(
  'ad000001-0001-4000-8000-000000000005',
  'Performance Benchmark Report 2025',
  'performance-benchmark-2025',
  'benchmark',
  2025,
  ARRAY['Infrastructure Team', 'QA Team'],
  'Annual performance benchmarking covering response times, throughput, scalability under load, and resource utilization.',
  'en',
  'archive/reports/performance-benchmark-2025.pdf',
  ARRAY['performance', 'benchmark', 'scalability', 'load-testing'],
  true,
  '2025-02-15 10:00:00+00'
),
(
  'ad000001-0001-4000-8000-000000000006',
  'Data Processing Agreement Template',
  'data-processing-agreement-template',
  'legal_document',
  2024,
  ARRAY['Legal Team'],
  'Standard data processing agreement for partners and third-party integrations, GDPR and SOC 2 compliant.',
  'en',
  'archive/legal/dpa-template-v2.pdf',
  ARRAY['legal', 'dpa', 'gdpr', 'soc2', 'compliance'],
  false,
  '2024-08-10 10:00:00+00'
),
(
  'ad000001-0001-4000-8000-000000000007',
  'User Onboarding Best Practices Guide',
  'user-onboarding-best-practices',
  'guide',
  2025,
  ARRAY['Product Team', 'UX Research'],
  'Comprehensive guide for optimizing user onboarding flows, reducing time-to-value, and improving activation rates.',
  'en',
  'archive/guides/onboarding-best-practices.pdf',
  ARRAY['onboarding', 'ux', 'activation', 'best-practices'],
  true,
  '2025-01-20 10:00:00+00'
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  slug = EXCLUDED.slug,
  document_type = EXCLUDED.document_type,
  year = EXCLUDED.year,
  people = EXCLUDED.people,
  preparation = EXCLUDED.preparation,
  original_language = EXCLUDED.original_language,
  storage_path = EXCLUDED.storage_path,
  keywords = EXCLUDED.keywords,
  is_public = EXCLUDED.is_public;

-- ============================================================================
