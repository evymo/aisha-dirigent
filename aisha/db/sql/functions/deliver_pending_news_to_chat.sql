-- Source of truth for deliver_pending_news_to_chat
-- Delivers unread published news articles to user's chat as assistant messages
-- with localized titles and excerpts, tracking delivery to avoid duplicates

CREATE OR REPLACE FUNCTION deliver_pending_news_to_chat()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id         uuid := auth.uid();
  v_locale          text;
  v_article         RECORD;
  v_conversation_id uuid;
  v_message_id      uuid;
  v_title           text;
  v_excerpt         text;
  v_msg_body        text;
  v_greeting        text;
  v_cta             text;
  v_delivered_count integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only deliver to users who can chat
  IF NOT public.user_can_chat(v_user_id) THEN
    RETURN 0;
  END IF;

  -- Get user's preferred language (terminal failover: en)
  SELECT COALESCE(p.preferred_language, 'en')
    INTO v_locale
    FROM public.profiles p
   WHERE p.id = v_user_id;

  IF v_locale IS NULL THEN
    v_locale := 'en';
  END IF;

  -- Prepare greeting/CTA per locale
  CASE v_locale
    WHEN 'cs' THEN
      v_greeting := 'Ahoj! Mám pro tebe novinku:';
      v_cta      := 'Chceš vědět víc? Klidně se ptej!';
    WHEN 'de' THEN
      v_greeting := 'Hallo! Ich habe Neuigkeiten für dich:';
      v_cta      := 'Möchtest du mehr erfahren? Frag einfach!';
    WHEN 'fr' THEN
      v_greeting := 'Salut ! J''ai des nouvelles pour toi :';
      v_cta      := 'Tu veux en savoir plus ? N''hésite pas à demander !';
    WHEN 'ru' THEN
      v_greeting := 'Привет! У меня для тебя новость:';
      v_cta      := 'Хочешь узнать больше? Спрашивай!';
    WHEN 'th' THEN
      v_greeting := 'สวัสดี! ฉันมีข่าวสำหรับคุณ:';
      v_cta      := 'อยากทราบเพิ่มเติมไหม? ถามฉันได้เลย!';
    ELSE
      v_greeting := 'Hi! I have news for you:';
      v_cta      := 'Want to know more? Feel free to ask!';
  END CASE;

  -- Iterate undelivered published articles
  FOR v_article IN
    SELECT na.id, na.title_key, na.excerpt_key, na.slug
      FROM public.news_articles na
     WHERE na.is_published = true
       AND na.published_at IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.news_article_deliveries nad
              WHERE nad.news_article_id = na.id
                AND nad.user_id = v_user_id
           )
     ORDER BY na.published_at ASC
  LOOP
    -- Resolve title from translations
    SELECT t.value INTO v_title
      FROM public.translations t
     WHERE t.key = v_article.title_key
       AND t.namespace = 'news'
       AND t.locale = v_locale;

    -- Fallback to en if not found
    IF v_title IS NULL AND v_locale <> 'en' THEN
      SELECT t.value INTO v_title
        FROM public.translations t
       WHERE t.key = v_article.title_key
         AND t.namespace = 'news'
         AND t.locale = 'en';
    END IF;

    v_title := COALESCE(v_title, v_article.title_key);

    -- Resolve excerpt from translations
    IF v_article.excerpt_key IS NOT NULL THEN
      SELECT t.value INTO v_excerpt
        FROM public.translations t
       WHERE t.key = v_article.excerpt_key
         AND t.namespace = 'news'
         AND t.locale = v_locale;

      IF v_excerpt IS NULL AND v_locale <> 'en' THEN
        SELECT t.value INTO v_excerpt
          FROM public.translations t
         WHERE t.key = v_article.excerpt_key
           AND t.namespace = 'news'
           AND t.locale = 'en';
      END IF;
    END IF;

    -- Compose message body
    v_msg_body := v_greeting || E'\n\n' || v_title;
    IF v_excerpt IS NOT NULL THEN
      v_msg_body := v_msg_body || E'\n\n' || v_excerpt;
    END IF;
    v_msg_body := v_msg_body || E'\n\n' || v_cta;

    -- Find latest active conversation (or create one)
    SELECT cc.id INTO v_conversation_id
      FROM public.chat_conversations cc
     WHERE cc.user_id = v_user_id
       AND cc.status = 'active'
     ORDER BY cc.last_message_at DESC NULLS LAST
     LIMIT 1;

    IF v_conversation_id IS NULL THEN
      INSERT INTO public.chat_conversations (user_id, title, status)
      VALUES (v_user_id, 'Chat', 'active')
      RETURNING id INTO v_conversation_id;
    END IF;

    -- Insert assistant message
    INSERT INTO public.chat_messages (
      content,
      content_metadata,
      conversation_id,
      role,
      routing_category
    ) VALUES (
      v_msg_body,
      jsonb_build_object(
        'type', 'news_article',
        'news_article_id', v_article.id,
        'slug', v_article.slug
      ),
      v_conversation_id,
      'assistant',
      'news'
    )
    RETURNING id INTO v_message_id;

    -- Update conversation metadata
    UPDATE public.chat_conversations
       SET last_message_at = now(),
           message_count = message_count + 1,
           updated_at = now()
     WHERE id = v_conversation_id;

    -- Track delivery
    INSERT INTO public.news_article_deliveries (
      conversation_id,
      message_id,
      news_article_id,
      user_id
    ) VALUES (
      v_conversation_id,
      v_message_id,
      v_article.id,
      v_user_id
    );

    v_delivered_count := v_delivered_count + 1;
  END LOOP;

  -- Audit if anything was delivered
  IF v_delivered_count > 0 THEN
    INSERT INTO audit_journal (user_id, action, metadata)
    VALUES (
      v_user_id,
      'NEWS_CHAT_DELIVERY',
      jsonb_build_object(
        'area', 'content',
        'severity', 'info',
        'count', v_delivered_count
      )
    );
  END IF;

  RETURN v_delivered_count;
END;
$$;

REVOKE ALL ON FUNCTION deliver_pending_news_to_chat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deliver_pending_news_to_chat() TO authenticated;
