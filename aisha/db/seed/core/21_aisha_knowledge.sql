-- ============================================================================
-- STEP 21: AISHA Knowledge Items (56 rows from production)
-- Source of truth: Production Coolify DB (api.aisha.guru)
-- Guild-generated domain documentation for knowledge base search
-- ============================================================================

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'ca6f13c2-965f-4184-a69c-21be8c45b193',
    'domain_doc',
    'guild_db',
    'f51eb361-40e7-4b0f-9c33-bb140858c08f',
    'frontend-development',
    'Frontend Development',
    'Guild expertise area: Frontend Development. Translation key: guild.expertise.frontend.desc',
    '# Frontend Development

**Slug:** `frontend-development`
**Icon:** monitor
**Translation key:** `guild.expertise.frontend`
**Description key:** `guild.expertise.frontend.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Frontend Development skills.

## Specialist Matching

When a client project requires Frontend Development, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Frontend Development, refer to this expertise area and suggest relevant specialists. Use slug "frontend-development" for API lookups.',
    ARRAY['frontend-development', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'f51eb361-40e7-4b0f-9c33-bb140858c08f',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '0ef879e2-8c0a-4e1b-9b68-24ffdca42952',
    'domain_doc',
    'guild_db',
    'd9afe3fa-4cc0-4ea7-9661-82ba92c341f3',
    'backend-development',
    'Backend Development',
    'Guild expertise area: Backend Development. Translation key: guild.expertise.backend.desc',
    '# Backend Development

**Slug:** `backend-development`
**Icon:** server
**Translation key:** `guild.expertise.backend`
**Description key:** `guild.expertise.backend.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Backend Development skills.

## Specialist Matching

When a client project requires Backend Development, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Backend Development, refer to this expertise area and suggest relevant specialists. Use slug "backend-development" for API lookups.',
    ARRAY['backend-development', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'd9afe3fa-4cc0-4ea7-9661-82ba92c341f3',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'b12bec1d-f3c5-4fb3-ab03-d30e6a9cc5ef',
    'domain_doc',
    'guild_db',
    '8fc26b18-1c54-4c4f-8c89-268b1d5033c7',
    'fullstack',
    'Fullstack',
    'Guild expertise area: Fullstack. Translation key: guild.expertise.fullstack.desc',
    '# Fullstack

**Slug:** `fullstack`
**Icon:** layers
**Translation key:** `guild.expertise.fullstack`
**Description key:** `guild.expertise.fullstack.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Fullstack skills.

## Specialist Matching

When a client project requires Fullstack, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Fullstack, refer to this expertise area and suggest relevant specialists. Use slug "fullstack" for API lookups.',
    ARRAY['fullstack', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '8fc26b18-1c54-4c4f-8c89-268b1d5033c7',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'af649e2a-73cc-42a7-8b9b-80813ea8c2b7',
    'domain_doc',
    'guild_db',
    'd55df279-9f4f-42b7-9e80-2f0ad6a7ae43',
    'devops-infrastructure',
    'Devops Infrastructure',
    'Guild expertise area: Devops Infrastructure. Translation key: guild.expertise.devops.desc',
    '# Devops Infrastructure

**Slug:** `devops-infrastructure`
**Icon:** cloud
**Translation key:** `guild.expertise.devops`
**Description key:** `guild.expertise.devops.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Devops Infrastructure skills.

## Specialist Matching

When a client project requires Devops Infrastructure, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Devops Infrastructure, refer to this expertise area and suggest relevant specialists. Use slug "devops-infrastructure" for API lookups.',
    ARRAY['devops-infrastructure', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'd55df279-9f4f-42b7-9e80-2f0ad6a7ae43',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '4ddf571c-ac67-4246-bb10-f0cd67443fe7',
    'domain_doc',
    'guild_db',
    '693f45ca-308a-4ef8-8594-821eefb221b0',
    'database-design',
    'Database Design',
    'Guild expertise area: Database Design. Translation key: guild.expertise.database.desc',
    '# Database Design

**Slug:** `database-design`
**Icon:** database
**Translation key:** `guild.expertise.database`
**Description key:** `guild.expertise.database.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Database Design skills.

## Specialist Matching

When a client project requires Database Design, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Database Design, refer to this expertise area and suggest relevant specialists. Use slug "database-design" for API lookups.',
    ARRAY['database-design', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '693f45ca-308a-4ef8-8594-821eefb221b0',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '49fa4423-7ba2-4f11-94bd-e8d87d65dcb6',
    'domain_doc',
    'guild_db',
    '950d42ab-f3de-4c85-b98d-a251258514d2',
    'ux-design',
    'Ux Design',
    'Guild expertise area: Ux Design. Translation key: guild.expertise.ux.desc',
    '# Ux Design

**Slug:** `ux-design`
**Icon:** palette
**Translation key:** `guild.expertise.ux`
**Description key:** `guild.expertise.ux.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Ux Design skills.

## Specialist Matching

When a client project requires Ux Design, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Ux Design, refer to this expertise area and suggest relevant specialists. Use slug "ux-design" for API lookups.',
    ARRAY['ux-design', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '950d42ab-f3de-4c85-b98d-a251258514d2',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '9bc291b0-3355-4294-8f74-cb381cc0f0ab',
    'domain_doc',
    'guild_db',
    'db297f44-0c51-492d-adbc-ceb55c0085fc',
    'mobile-development',
    'Mobile Development',
    'Guild expertise area: Mobile Development. Translation key: guild.expertise.mobile.desc',
    '# Mobile Development

**Slug:** `mobile-development`
**Icon:** smartphone
**Translation key:** `guild.expertise.mobile`
**Description key:** `guild.expertise.mobile.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Mobile Development skills.

## Specialist Matching

When a client project requires Mobile Development, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Mobile Development, refer to this expertise area and suggest relevant specialists. Use slug "mobile-development" for API lookups.',
    ARRAY['mobile-development', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'db297f44-0c51-492d-adbc-ceb55c0085fc',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '3f5c3a99-70a5-45b8-868a-b6b64d8d4fad',
    'domain_doc',
    'guild_db',
    'f5e84e4e-1391-4974-abb6-65cbdbdfd7a9',
    'ai-machine-learning',
    'Ai Machine Learning',
    'Guild expertise area: Ai Machine Learning. Translation key: guild.expertise.ai.desc',
    '# Ai Machine Learning

**Slug:** `ai-machine-learning`
**Icon:** brain
**Translation key:** `guild.expertise.ai`
**Description key:** `guild.expertise.ai.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Ai Machine Learning skills.

## Specialist Matching

When a client project requires Ai Machine Learning, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Ai Machine Learning, refer to this expertise area and suggest relevant specialists. Use slug "ai-machine-learning" for API lookups.',
    ARRAY['ai-machine-learning', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'f5e84e4e-1391-4974-abb6-65cbdbdfd7a9',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'c74843c9-7b5c-49ab-81aa-1201f214f554',
    'domain_doc',
    'guild_db',
    '673bbb7d-cdf8-4841-a9a0-cc4334909d34',
    'security',
    'Security',
    'Guild expertise area: Security. Translation key: guild.expertise.security.desc',
    '# Security

**Slug:** `security`
**Icon:** shield
**Translation key:** `guild.expertise.security`
**Description key:** `guild.expertise.security.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Security skills.

## Specialist Matching

When a client project requires Security, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Security, refer to this expertise area and suggest relevant specialists. Use slug "security" for API lookups.',
    ARRAY['security', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '673bbb7d-cdf8-4841-a9a0-cc4334909d34',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'c8d3f1be-b824-4a63-a6df-07abae1724c4',
    'domain_doc',
    'guild_db',
    '1ed320c9-3102-4ad7-8b3d-690a582753f5',
    'testing-qa',
    'Testing Qa',
    'Guild expertise area: Testing Qa. Translation key: guild.expertise.testing.desc',
    '# Testing Qa

**Slug:** `testing-qa`
**Icon:** test-tube
**Translation key:** `guild.expertise.testing`
**Description key:** `guild.expertise.testing.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Testing Qa skills.

## Specialist Matching

When a client project requires Testing Qa, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Testing Qa, refer to this expertise area and suggest relevant specialists. Use slug "testing-qa" for API lookups.',
    ARRAY['testing-qa', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '1ed320c9-3102-4ad7-8b3d-690a582753f5',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '161ffaa4-52fc-4266-bf0b-b1061fac7f49',
    'domain_doc',
    'guild_db',
    'abc6219d-f3ab-4837-905d-20748c24665a',
    'project-management',
    'Project Management',
    'Guild expertise area: Project Management. Translation key: guild.expertise.pm.desc',
    '# Project Management

**Slug:** `project-management`
**Icon:** kanban
**Translation key:** `guild.expertise.pm`
**Description key:** `guild.expertise.pm.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Project Management skills.

## Specialist Matching

When a client project requires Project Management, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Project Management, refer to this expertise area and suggest relevant specialists. Use slug "project-management" for API lookups.',
    ARRAY['project-management', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'abc6219d-f3ab-4837-905d-20748c24665a',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '3a9ac276-c106-4f74-b1a3-2a3d5a69fe94',
    'domain_doc',
    'guild_db',
    'f7263088-3e62-44a6-8b6c-b9ca2f2a7488',
    'api-integrations',
    'Api Integrations',
    'Guild expertise area: Api Integrations. Translation key: guild.expertise.api.desc',
    '# Api Integrations

**Slug:** `api-integrations`
**Icon:** plug
**Translation key:** `guild.expertise.api`
**Description key:** `guild.expertise.api.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Api Integrations skills.

## Specialist Matching

When a client project requires Api Integrations, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Api Integrations, refer to this expertise area and suggest relevant specialists. Use slug "api-integrations" for API lookups.',
    ARRAY['api-integrations', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'f7263088-3e62-44a6-8b6c-b9ca2f2a7488',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '1e03c655-7744-42a7-b542-b787051f7792',
    'domain_doc',
    'guild_db',
    '24259816-0e4a-4b28-8a53-72a5e93317c6',
    'data-engineering',
    'Data Engineering',
    'Guild expertise area: Data Engineering. Translation key: guild.expertise.data.desc',
    '# Data Engineering

**Slug:** `data-engineering`
**Icon:** bar-chart
**Translation key:** `guild.expertise.data`
**Description key:** `guild.expertise.data.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Data Engineering skills.

## Specialist Matching

When a client project requires Data Engineering, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Data Engineering, refer to this expertise area and suggest relevant specialists. Use slug "data-engineering" for API lookups.',
    ARRAY['data-engineering', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '24259816-0e4a-4b28-8a53-72a5e93317c6',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'a625251f-bb9d-485d-bf67-f3b1018fc145',
    'domain_doc',
    'guild_db',
    'e6279a3f-cb02-4efa-ab95-09649a92797d',
    'blockchain-web3',
    'Blockchain Web3',
    'Guild expertise area: Blockchain Web3. Translation key: guild.expertise.blockchain.desc',
    '# Blockchain Web3

**Slug:** `blockchain-web3`
**Icon:** link
**Translation key:** `guild.expertise.blockchain`
**Description key:** `guild.expertise.blockchain.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Blockchain Web3 skills.

## Specialist Matching

When a client project requires Blockchain Web3, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Blockchain Web3, refer to this expertise area and suggest relevant specialists. Use slug "blockchain-web3" for API lookups.',
    ARRAY['blockchain-web3', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    'e6279a3f-cb02-4efa-ab95-09649a92797d',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '8447158a-c897-4f01-aec7-347cfa57e1f2',
    'domain_doc',
    'guild_db',
    '266ed6e7-559f-4d0b-bdd8-21b621559510',
    'performance-optimization',
    'Performance Optimization',
    'Guild expertise area: Performance Optimization. Translation key: guild.expertise.performance.desc',
    '# Performance Optimization

**Slug:** `performance-optimization`
**Icon:** zap
**Translation key:** `guild.expertise.performance`
**Description key:** `guild.expertise.performance.desc`

This is a guild expertise area in the AISHA platform. Specialists with this expertise can be matched to projects requiring Performance Optimization skills.

## Specialist Matching

When a client project requires Performance Optimization, the Dirigent agent should:
1. Search for specialists with this expertise area
2. Check availability and capacity
3. Verify qualifications and past project ratings
4. Propose matching to the client
',
    'When asked about Performance Optimization, refer to this expertise area and suggest relevant specialists. Use slug "performance-optimization" for API lookups.',
    ARRAY['performance-optimization', 'expertise', 'guild', 'specialist-matching']::text[],
    'guild_expertise',
    '266ed6e7-559f-4d0b-bdd8-21b621559510',
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00',
    '2026-03-14T22:18:38.686276+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '020f13ce-f9b6-4464-956e-8a44a57703d9',
    'engineering_doc',
    'agent_catalog',
    '9e5089bb-5893-47ee-b8de-94a7cdec6587',
    'debug_agent',
    'Debug Agent',
    'AI Agent: Debug Agent — Purpose: debugging',
    '# Debug Agent

**Slug:** `debug_agent`
**Purpose:** debugging
**Default Model:** `reasoning`
**Safety Level:** standard
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `get_story_context`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles debugging tasks with a standard safety level.
',
    'Agent "debug_agent" is a debugging agent. Route debugging tasks to this agent. Safety level: standard.',
    ARRAY['debug_agent', 'agent', 'orchestration', 'debugging']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '8585b914-8e43-414d-a78a-b733d0407be2',
    'engineering_doc',
    'agent_catalog',
    'b5030d9d-a425-4ed2-91e8-41c2bd870e00',
    'verifier',
    'Verifier',
    'AI Agent: Verifier — Purpose: verification',
    '# Verifier

**Slug:** `verifier`
**Purpose:** verification
**Default Model:** `reasoning`
**Safety Level:** strict
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `validate_compliance`
- `get_story_context`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles verification tasks with a strict safety level.
',
    'Agent "verifier" is a verification agent. Route verification tasks to this agent. Safety level: strict.',
    ARRAY['verifier', 'agent', 'orchestration', 'verification']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'bb372cd6-8c08-4b01-99ce-c9b2bc6a316e',
    'engineering_doc',
    'agent_catalog',
    '989ce855-2608-4208-b831-ca9a5cd794cd',
    'dirigent',
    'Dirigent — Development Flow Moderator',
    'AI Agent: Dirigent — Development Flow Moderator — Purpose: moderation',
    '# Dirigent — Development Flow Moderator

**Slug:** `dirigent`
**Purpose:** moderation
**Default Model:** `gpt-strong`
**Safety Level:** strict
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `get_story_context`
- `get_expertise_areas`
- `get_expert_rule`
- `validate_compliance`
- `moderate_flow`
- `evaluate_tests`
- `assess_quality`
- `suggest_next_step`
- `estimate_effort`
- `check_pr_compliance`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles moderation tasks with a strict safety level.
',
    'Agent "dirigent" is a moderation agent. Route moderation tasks to this agent. Safety level: strict.',
    ARRAY['dirigent', 'agent', 'orchestration', 'moderation']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'c4cdaa25-6447-46b2-a980-cd4632e80392',
    'engineering_doc',
    'agent_catalog',
    '27dacb22-83a9-4adf-8b8b-017c016a2649',
    'aisha_planner',
    'Aisha Planner',
    'AI Agent: Aisha Planner — Purpose: planning',
    '# Aisha Planner

**Slug:** `aisha_planner`
**Purpose:** planning
**Default Model:** `claude-opus`
**Safety Level:** strict
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `get_story_context`
- `get_expertise_areas`
- `match_experts`
- `get_knowledge_stats`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles planning tasks with a strict safety level.
',
    'Agent "aisha_planner" is a planning agent. Route planning tasks to this agent. Safety level: strict.',
    ARRAY['aisha_planner', 'agent', 'orchestration', 'planning']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'b462ebec-79ea-4176-b93f-9a079ccffbc0',
    'engineering_doc',
    'agent_catalog',
    'ecf87ca2-db03-4296-959f-b2d9e7e4c688',
    'dev_patch',
    'Dev Patch Agent',
    'AI Agent: Dev Patch Agent — Purpose: patching',
    '# Dev Patch Agent

**Slug:** `dev_patch`
**Purpose:** patching
**Default Model:** `code_strong`
**Safety Level:** standard
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `get_story_context`
- `get_expert_rule`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles patching tasks with a standard safety level.
',
    'Agent "dev_patch" is a patching agent. Route patching tasks to this agent. Safety level: standard.',
    ARRAY['dev_patch', 'agent', 'orchestration', 'patching']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    '7a509382-c971-419d-9700-f4549942a4fc',
    'engineering_doc',
    'agent_catalog',
    'f2caab8c-f484-416e-9776-2a52f6ebfde9',
    'compliance_gate',
    'Compliance Gate',
    'AI Agent: Compliance Gate — Purpose: compliance',
    '# Compliance Gate

**Slug:** `compliance_gate`
**Purpose:** compliance
**Default Model:** `reasoning`
**Safety Level:** strict
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `validate_compliance`
- `get_story_context`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles compliance tasks with a strict safety level.
',
    'Agent "compliance_gate" is a compliance agent. Route compliance tasks to this agent. Safety level: strict.',
    ARRAY['compliance_gate', 'agent', 'orchestration', 'compliance']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'd7be53b3-5c3e-4b50-b7c1-ac379ccfdc68',
    'engineering_doc',
    'agent_catalog',
    '4384a1f6-b27d-41d1-8c22-305a87255fa9',
    'librarian',
    'Knowledge Librarian',
    'AI Agent: Knowledge Librarian — Purpose: documentation',
    '# Knowledge Librarian

**Slug:** `librarian`
**Purpose:** documentation
**Default Model:** `fast`
**Safety Level:** minimal
**Active:** Yes

## Allowed Tools

- `search_knowledge_v2`
- `get_knowledge_item`
- `get_knowledge_stats`
- `get_expertise_areas`

## Role in Platform

This agent is part of the AISHA AI orchestration system (Aisha). It handles documentation tasks with a minimal safety level.
',
    'Agent "librarian" is a documentation agent. Route documentation tasks to this agent. Safety level: minimal.',
    ARRAY['librarian', 'agent', 'orchestration', 'documentation']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00',
    '2026-03-14T22:18:38.69788+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'f98d9c4c-0d7c-4cb3-9df3-614e1fb0b3cb',
    'playbook',
    'manual',
    NULL,
    'chat-delegation-playbook',
    'Playbook: Chat Delegation Response',
    'Operational playbook for Aisha Dirigent when participating as third-party in AI Chat conversations.',
    '# Playbook: Chat Delegation Response

## When This Playbook Applies

Triggered when `action: chat_delegation` arrives via orchestrationBridge.
Signal in prompt: `[CHAT DELEGATION]`

## Role

You are NOT the main AI assistant. You are **Aisha Dirigent** — an expert who enters the conversation only when you have valuable input.

## Rules

1. **Brevity**: 1-3 sentences unless more is needed
2. **Language**: Match the user''s language
3. **Compliance alert**: Prefix with `[ESKALACE]`
4. **Correction**: Prefix with `[OVERRIDE]` when AI gave wrong advice
5. **Silence**: Return empty string if nothing to add (not "I have nothing to say")
6. **Knowledge**: Reference knowledge base via `search_knowledge` when relevant
7. **No repetition**: Never repeat what the AI assistant already said
8. **Identity**: Present as "Aisha Dirigent", not as a robot

## Decision Matrix

| User Topic | Action | Example |
|------------|--------|---------|
| Compliance question | search_knowledge → answer with rules | "Podle pravidla X..." |
| Mentions Aisha | Respond directly, introduce yourself | "Jsem Aisha Dirigent..." |
| AI gave wrong advice | [OVERRIDE] + correct answer | "[OVERRIDE] Správně je..." |
| Security concern | [ESKALACE] + explanation | "[ESKALACE] Toto porušuje..." |
| Irrelevant topic | Empty string (silent) | "" |
| Project planning | Offer delivery expertise | "Doporučuji..." |

## Integration Points

- **orchestrationBridge.ts**: `shouldAishaRespond()` + `delegateToAisha()`
- **WF_DIRIGENT_AGENT**: Prepare Webhook Input + Format Webhook Response
- **aisha-callback**: Async message push endpoint
- **AiChatWidget.tsx**: Violet Dirigent message bubbles
',
    'This is the operational playbook for chat delegation. When Aisha needs to decide whether to respond in a chat, follow this playbook. Key decision: silence (empty string) vs comment vs escalate vs override. Always be brief, match user language, and never repeat the AI assistant.',
    ARRAY['aisha', 'chat-delegation', 'playbook', 'dirigent', 'ai-chat', 'response-protocol']::text[],
    'ai_agents',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:55:42.650285+00:00',
    '2026-03-14T22:55:42.650285+00:00',
    '2026-03-14T22:55:42.650285+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id,
    item_type,
    source_type,
    source_id,
    source_slug,
    title,
    summary,
    body_markdown,
    ai_instructions,
    ai_context_tags,
    category,
    expertise_area_id,
    status,
    visibility,
    version,
    author_id,
    author_display_name,
    usage_count,
    rating_avg,
    is_verified,
    published_at,
    created_at,
    updated_at
) VALUES (
    'd47578f9-4075-4f53-be00-7c058840f7bb',
    'engineering_doc',
    'manual',
    NULL,
    'chat-delegation-architecture',
    'Architecture: Aisha Chat Delegation Protocol',
    'Technical architecture for Aisha Dirigent participating as third-party in AI Chat conversations via orchestrationBridge delegation.',
    '# Aisha Chat Delegation Protocol

## Overview

Aisha Dirigent can participate as a **third-party expert** in user AI Chat sessions. The system detects when Aisha should respond (explicit mentions, escalation signals, relevant topics) and delegates the conversation context to n8n.

## Flow

```
User message → ai-chat Edge Function → shouldAishaRespond() check
  ├── No → normal AI response only
  └── Yes → delegateToAisha() → n8n webhook
      → Prepare Webhook Input (builds prompt from context)
      → AISHA Dirigent Agent (LLM with Chat Delegation Playbook)
      → Format Webhook Response (content + action)
      → Response back to Edge Function
      → INSERT aisha_message into ai_chat_messages
      → Realtime broadcast → violet bubble in UI
```

## Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `shouldAishaRespond()` | orchestrationBridge.ts | Detection logic |
| `delegateToAisha()` | orchestrationBridge.ts | Webhook call + parsing |
| Prepare Webhook Input | WF_DIRIGENT_AGENT | Build structured prompt |
| Chat Delegation Playbook | WF_DIRIGENT_AGENT system prompt | Agent instructions |
| Format Webhook Response | WF_DIRIGENT_AGENT | Return content+action |
| aisha-callback | Edge Function | Async message push |

## Detection Signals

`shouldAishaRespond()` checks:
1. Explicit mention: "aisha", "dirigent" in user message
2. Escalation signals: "compliance", "security", "eskalace", "override"
3. Category relevance: compliance, security topics

## Response Actions

| Action | Meaning | UI Effect |
|--------|---------|----------|
| `silent` | Nothing to add | No message shown |
| `comment` | Expert observation | Violet bubble |
| `escalate` | Compliance/security issue | Violet bubble + alert |
| `override` | Correct AI mistake | Violet bubble + correction |

## Security

- Webhook authenticated via N8N_API_KEY header
- aisha-callback validates N8N_API_KEY or SERVICE_ROLE_KEY
- No PII/health data sent in delegation context
- Conversation history truncated (max 300 chars per message)
',
    'This document describes the Chat Delegation Protocol for Aisha Dirigent. When asked about how Aisha participates in AI Chat, refer to this architecture. Key functions: shouldAishaRespond(), delegateToAisha(). Actions: silent, comment, escalate, override.',
    ARRAY['aisha', 'chat-delegation', 'orchestration', 'architecture', 'ai-chat', 'dirigent']::text[],
    'architecture_pattern',
    NULL,
    'active',
    'guild',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-03-14T22:18:39.358163+00:00',
    '2026-03-14T22:18:39.358163+00:00',
    '2026-03-14T22:18:39.358163+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_slug,
    title, summary, body_markdown, ai_instructions,
    ai_context_tags, category, expertise_area_id, status, visibility, version,
    author_id, author_display_name, usage_count, rating_avg, is_verified, published_at, created_at, updated_at
) VALUES (
    'cb000000-0b51-0000-0000-ae0dec000001',
    'engineering_doc',
    'manual',
    'shell-heredoc-dollar-quoting',
    'Shell Heredoc + PostgreSQL Dollar-Quoting',
    'Správné escapování $$ v shell heredocích pro PostgreSQL DO bloky. Quoted heredoc (<<DELIM bez uvozovek provádí expanzi, <<''DELIM'' ne).',
    E'# Shell Heredoc + PostgreSQL Dollar-Quoting\n\n'
    || E'## Problém\n'
    || E'PostgreSQL DO bloky používají `$$` jako delimiter. Shell heredocy mohou `$` interpretovat.\n\n'
    || E'## Pravidlo\n\n'
    || E'| Heredoc typ | Shell expanze? | Správné dollar-quoting |\n'
    || E'|-------------|----------------|----------------------|\n'
    || E'| `<<''DELIM''` (quoted) | NE | `DO $$ BEGIN ... END $$;` |\n'
    || E'| `<<DELIM` (unquoted) | ANO | `DO \\$\\$ BEGIN ... END \\$\\$;` |\n\n'
    || E'## Reálná chyba (2026-04-09)\n'
    || E'`db-entrypoint-wrapper.sh` používal `<<''SETUP''` (quoted heredoc) ale `DO \\$\\$` (escaped).\n'
    || E'Shell v quoted heredocu neprovádí expanzi → psql dostal literal `\\$\\$` → syntax error.\n'
    || E'DO blok se tiše nespustil (ON_ERROR_STOP=0) → ownership transfer se neprovedl → Prisma migrate failnul.\n\n'
    || E'## Fix: Změna `\\$\\$` → `$$` v quoted heredocu.\n\n'
    || E'## Gate test: infrastructure-security.gate.test.ts\n',
    'Když uživatel řeší problémy s PostgreSQL DO bloky v shell scriptech, zkontroluj typ heredocu. V quoted heredocu (<<''DELIM'') NESMÍ být \$\$ — musí být holé $$.',
    ARRAY['shell', 'heredoc', 'postgresql', 'dollar-quoting', 'do-block', 'escaping', 'coolify', 'devops']::text[],
    'devops',
    NULL,
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-04-09T06:00:00+00:00',
    '2026-04-09T06:00:00+00:00',
    '2026-04-09T06:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_slug,
    title, summary, body_markdown, ai_instructions,
    ai_context_tags, category, expertise_area_id, status, visibility, version,
    author_id, author_display_name, usage_count, rating_avg, is_verified, published_at, created_at, updated_at
) VALUES (
    'cb000000-0b52-0000-0000-b015a0000002',
    'engineering_doc',
    'manual',
    'prisma-table-ownership-requirement',
    'Prisma Migrate — Table Ownership Requirement',
    'Prisma migrate vyžaduje OWNERSHIP (ne jen GRANT ALL) na tabulkách pro DDL operace.',
    E'# Prisma Migrate — Table Ownership Requirement\n\n'
    || E'## Symptom\n'
    || E'```\nSqlState(E42501): must be owner of table pending_deletions\n```\n\n'
    || E'## Root Cause\n'
    || E'Tabulky vytvořené administrátorskou DB rolí (např. aisha_admin/postgres) mají ownera mimo aplikační roli.\n'
    || E'Langfuse se připojuje jako langfuse_app → nemá ownership → DDL selhává.\n'
    || E'Pouhé GRANT ALL NESTAČÍ — Prisma kontroluje pg_tables.tableowner.\n\n'
    || E'## Fix Pattern\n'
    || E'1. `ALTER SCHEMA langfuse OWNER TO langfuse_app;`\n'
    || E'2. DO $$ loop: ALTER TABLE/SEQUENCE/TYPE ... OWNER TO langfuse_app pro existující objekty\n'
    || E'3. ALTER DEFAULT PRIVILEGES pro budoucí objekty\n'
    || E'4. Spouštět při KAŽDÉM bootu DB (ne jen first boot)\n\n'
    || E'## Anti-patterns\n'
    || E'- GRANT ALL bez ownership transfer\n'
    || E'- Spouštět Prisma jako superuser\n'
    || E'- Ownership transfer jen v initdb.d (běží jen na prázdném volume)\n',
    'Pokud uživatel hlásí "must be owner of table" z Prisma, vždy zkontroluj pg_tables.tableowner. GRANT ALL nestačí — potřebuje ALTER TABLE ... OWNER TO.',
    ARRAY['prisma', 'ownership', 'postgresql', 'langfuse', 'ddl', 'grant', 'migration', 'database']::text[],
    'devops',
    NULL,
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-04-09T06:00:00+00:00',
    '2026-04-09T06:00:00+00:00',
    '2026-04-09T06:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_slug,
    title, summary, body_markdown, ai_instructions,
    ai_context_tags, category, expertise_area_id, status, visibility, version,
    author_id, author_display_name, usage_count, rating_avg, is_verified, published_at, created_at, updated_at
) VALUES (
    'cb000000-0b53-0000-0000-c001fd100003',
    'engineering_doc',
    'manual',
    'coolify-exited-container-diagnostics',
    'Coolify — Diagnostika Exited Kontejnerů',
    'Coolify API /logs vrací jen logy běžících kontejnerů. Pro diagnostiku exited kontejnerů loguj do DB tabulky.',
    E'# Coolify — Diagnostika Exited Kontejnerů\n\n'
    || E'## Problém\n'
    || E'Migrate kontejner exitne za <1s. Coolify API vrací jen logy BĚŽÍCÍCH kontejnerů.\n\n'
    || E'## Diagnostický Pattern\n'
    || E'1. Dočasný entrypoint co loguje do DB tabulky `_debug_migrate_log`\n'
    || E'2. `exit 0` force mode aby web container nastartoval\n'
    || E'3. Čtení: `SELECT msg FROM _debug_migrate_log ORDER BY ts DESC LIMIT 1;`\n'
    || E'4. Po diagnostice VŽDY revert na produkční entrypoint\n\n'
    || E'## Docker Compose depends_on\n'
    || E'`service_completed_successfully` condition = migrate MUSÍ exit 0.\n'
    || E'Pokud migrate exit 1 → web nikdy nenastartuje → 503.\n\n'
    || E'## Coolify API Limitace\n'
    || E'- `GET /applications/{uuid}/logs` → jen running containers\n'
    || E'- `GET /deployments/{id}` → build logy, NE container stdout\n'
    || E'- Žádné server execute API\n',
    'Pro diagnostiku exited kontejnerů v Coolify: dočasný entrypoint co loguje do DB tabulky, force exit 0, po diagnostice revert.',
    ARRAY['coolify', 'docker', 'diagnostics', 'migrate', 'container', 'logging', 'devops', 'debug']::text[],
    'devops',
    NULL,
    'active',
    'public',
    1,
    NULL,
    NULL,
    0,
    0,
    true,
    '2026-04-09T06:00:00+00:00',
    '2026-04-09T06:00:00+00:00',
    '2026-04-09T06:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Platform overview docs (Brick0 corpus completion — cl-* golden coverage)
-- ----------------------------------------------------------------------------
-- domain_doc knowledge_items describing the platform itself, so prod chat can
-- answer "what is AISHA / what is a story / agents vs rules / how does deploy
-- work" from retrieval. Grounded in: README.md, .claude/skills/aisha-deploy-flow,
-- docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md, partner_stories per-story isolation.
-- Summaries carry the question keywords because mcp_search_knowledge_v2 text-ranks
-- on title + summary.
-- ============================================================================

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_id, source_slug, title, summary, body_markdown,
    ai_instructions, ai_context_tags, category, expertise_area_id, status, visibility,
    version, author_id, author_display_name, usage_count, rating_avg, is_verified,
    published_at, created_at, updated_at
) VALUES (
    '55e52bef-e34b-4b27-a5d2-92648483d535',
    'domain_doc', 'manual', NULL, 'aisha-platform-overview',
    'AISHA Platform Overview',
    'AISHA is a multi-agent AI orchestrator platform — a self-managing developer platform where the autonomous AISHA Dirigent drives the full delivery lifecycle (planning, compliance, implementation, self-healing infrastructure) through stories, agents, and expert rules. It is also a community platform that matches clients with expert specialists. It is a platform, not a chatbot.',
    E'# AISHA Platform Overview\n\n**AISHA** (Autonomous Intelligent System for Holistic Automation) is a self-managing developer platform. The autonomous **AISHA Dirigent** orchestrates the whole delivery lifecycle — from planning, through compliance checks, to autonomous self-healing of infrastructure.\n\n## What it is\n- A **multi-agent AI orchestrator**: AI agents (in the developer''s IDE — VS Code, Cursor, Windsurf — via the `aisha-dirigent` extension) connect to a central backend and share their reasoning with the Dirigent, which evaluates and corrects it.\n- A **community platform** that matches clients with expert specialists (guild expertise areas) and project work.\n- **Not a chatbot** — a platform for autonomous software development and operations.\n\n## Core building blocks\n- **Stories** — multi-tenant isolation units (see `aisha-story-concept`).\n- **Agents** — autonomous actors that execute tasks (see `aisha-agents-vs-rules`).\n- **Expert rules** — declarative knowledge/policies that constrain agents.\n\n## Stack\nSelf-hosted PostgreSQL 17 + PostgREST + AISHA Gateway (Fastify) + domain microservices; n8n orchestration (Dirigent + sub-agents + self-learning loop); Appsmith operational dashboard.',
    'When asked what AISHA is, its purpose, or for a one-sentence overview, cite this. AISHA = multi-agent AI orchestrator platform driven by the autonomous AISHA Dirigent; it is a platform, not a chatbot.',
    ARRAY['brand','orientation','platform','overview','aisha','orchestrator']::text[],
    'platform_doc', NULL, 'active', 'public',
    1, NULL, NULL, 0, 0, true,
    '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_id, source_slug, title, summary, body_markdown,
    ai_instructions, ai_context_tags, category, expertise_area_id, status, visibility,
    version, author_id, author_display_name, usage_count, rating_avg, is_verified,
    published_at, created_at, updated_at
) VALUES (
    '0ebd3329-2d29-431b-a16d-6f1f70a4f0cc',
    'domain_doc', 'manual', NULL, 'aisha-story-concept',
    'AISHA Story — Multi-Tenant Isolation Unit',
    'A story is AISHA''s multi-tenant isolation unit. Each story owns its own knowledge_items, agents, expert_rules, and deployment context; per-story isolation gates every knowledge reader by story_id (membership, not visibility). A client project typically runs as its own story.',
    E'# AISHA Story — the multi-tenant isolation unit\n\nA **story** (příběh) is the unit of multi-tenant isolation in AISHA. Each story has:\n- its own **knowledge_items**, **agents**, **expert_rules**, and **deployment context**;\n- **per-story isolation** — every SECURITY DEFINER knowledge reader gates by `story_id` (this is membership/`story_id`, not a `visibility` flag).\n\nA client project usually runs as its own story, so its knowledge and agents never leak across tenants. Story binding also drives which knowledge the retrieval layer (`compose_context` -> `mcp_search_knowledge`) is allowed to return.',
    'When asked what a story (příběh) is in AISHA, cite this. A story = multi-tenant isolation unit owning its knowledge_items/agents/expert_rules/deploy context; isolation is by story_id membership.',
    ARRAY['platform','story','multitenant','isolation','story_id']::text[],
    'platform_doc', NULL, 'active', 'public',
    1, NULL, NULL, 0, 0, true,
    '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_id, source_slug, title, summary, body_markdown,
    ai_instructions, ai_context_tags, category, expertise_area_id, status, visibility,
    version, author_id, author_display_name, usage_count, rating_avg, is_verified,
    published_at, created_at, updated_at
) VALUES (
    'e6e6732f-8edc-464c-a879-077a966f1a49',
    'domain_doc', 'manual', NULL, 'aisha-agents-vs-rules',
    'AISHA Agents vs Expert Rules',
    'An AISHA agent is an autonomous actor that executes tasks (writes code, runs tests, deploys). An expert rule is declarative knowledge or policy that constrains agent behaviour — it is retrieved and injected into prompts via compose_context. Agents act; expert rules guide.',
    E'# AISHA Agents vs Expert Rules\n\nTwo distinct concepts that work together:\n\n## Agent\nAn **autonomous actor** that *executes* tasks — writes code, runs tests, deploys, remediates drift. Agents are the AISHA Dirigent and its sub-agents (orchestrated via n8n).\n\n## Expert rule\n**Declarative knowledge / policy** that *constrains* what agents do — e.g. RPC-only data access, no `--no-verify`, no emoji in UI, RLS on every table. Expert rules are retrieved and **injected into agent prompts via `compose_context`** (they are mirrored into `knowledge_items` so retrieval can find them).\n\n**In one line:** agents act; expert rules guide. An agent decides *how* to do the work; expert rules define the *constraints* it must respect.',
    'When asked the difference between an AISHA agent and an expert rule, cite this. Agent = autonomous actor that executes; expert rule = declarative policy retrieved/injected via compose_context that constrains the agent.',
    ARRAY['platform','agents','rules','distinction','compose_context']::text[],
    'platform_doc', NULL, 'active', 'public',
    1, NULL, NULL, 0, 0, true,
    '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.knowledge_items (
    id, item_type, source_type, source_id, source_slug, title, summary, body_markdown,
    ai_instructions, ai_context_tags, category, expertise_area_id, status, visibility,
    version, author_id, author_display_name, usage_count, rating_avg, is_verified,
    published_at, created_at, updated_at
) VALUES (
    'b383e9b6-e7bf-4359-992b-9c0b7ca363c4',
    'domain_doc', 'manual', NULL, 'aisha-deploy-flow-overview',
    'AISHA Autonomous Deploy Flow (4 Phases)',
    'AISHA deploys a story to production via a 4-phase autonomous flow: Phase 1 drift detection (drift_state), Phase 2 blue/green orchestration (coolify_app_slots), Phase 3 Sentry-driven rollback monitoring (rollback_history), Phase 4 Appsmith dashboard regeneration. All phases write to audit_journal and respect the approval gate.',
    E'# AISHA Autonomous Deploy Flow\n\nThe self-managing deploy flow has **4 phases**:\n\n| Phase | Name | Trigger | State table |\n|-------|------|---------|-------------|\n| 1 | **Drift Observer** | cron 10 min, autonomous read, gated remediation | `drift_state` |\n| 2 | **Blue/Green Orchestration** | webhook-driven, per Coolify app | `coolify_app_slots` |\n| 3 | **Sentry Observer** | cron 5 min, post-switch correlation, gated rollback | `rollback_history` |\n| 4 | **Dashboard Builder** | cron 30 min, regenerable Appsmith UI | `dashboard_render_history` |\n\nAll phases write to **audit_journal** and respect the **approval gate** (high-risk remediations/rollbacks require approval). Full design: `docs/deploy/AUTONOMOUS_DEPLOY_FLOW.md`; operating manual: the `aisha-deploy-flow` skill.',
    'When asked how AISHA deploys a story to production, cite this. The deploy flow is 4 phases: drift detection -> blue/green -> Sentry rollback -> Appsmith dashboard regen, all gated + audited.',
    ARRAY['platform','deploy','autonomy','blue-green','drift','rollback']::text[],
    'platform_doc', NULL, 'active', 'public',
    1, NULL, NULL, 0, 0, true,
    '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00', '2026-06-29T00:00:00+00:00'
)
ON CONFLICT (id) DO NOTHING;
