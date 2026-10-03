-- Table: news_article_deliveries

CREATE TABLE IF NOT EXISTS public.news_article_deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid REFERENCES public.chat_conversations ON DELETE SET NULL,
  delivered_at timestamp with time zone DEFAULT now() NOT NULL,
  message_id uuid REFERENCES public.chat_messages ON DELETE SET NULL,
  news_article_id uuid NOT NULL REFERENCES public.news_articles ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES aisha_auth.users ON DELETE CASCADE,
  PRIMARY KEY (id)
);

ALTER TABLE public.news_article_deliveries ENABLE ROW LEVEL SECURITY;
