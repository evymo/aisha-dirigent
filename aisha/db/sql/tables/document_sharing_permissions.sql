CREATE TABLE IF NOT EXISTS public.document_sharing_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES public.member_health_documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
    shared_with_partner_id UUID REFERENCES public.partner_profiles(id),
    shared_with_study_id UUID REFERENCES public.studies(id),
    can_view BOOLEAN DEFAULT false,
    can_use_for_statistics BOOLEAN DEFAULT false,
    can_use_for_research BOOLEAN DEFAULT false,
    granted_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.document_sharing_permissions ENABLE ROW LEVEL SECURITY;
