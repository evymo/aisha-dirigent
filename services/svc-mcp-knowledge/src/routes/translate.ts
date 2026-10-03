/**
 * POST /translate — AI-powered content translation using OpenAI.
 * Supports batch translation of i18n keys or freeform text.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, isAdminOrStaff, AuthError } from '../auth.js';
import { config } from '../config.js';

interface TranslateBody {
  texts: Array<{ key?: string; text: string }>;
  source_lang: string;
  target_lang: string;
  context?: string;
}

export async function translateRoutes(app: FastifyInstance): Promise<void> {
  app.post('/translate', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      return reply.code(err instanceof AuthError ? err.statusCode : 401).send({ error: 'Unauthorized' });
    }
    if (!isAdminOrStaff(user)) {
      return reply.code(403).send({ error: 'Admin or staff required' });
    }

    const body = req.body as TranslateBody | null;
    if (!body?.texts?.length || !body.source_lang || !body.target_lang) {
      return reply.code(400).send({ error: 'texts, source_lang, and target_lang required' });
    }

    if (body.texts.length > 100) {
      return reply.code(400).send({ error: 'Max 100 texts per request' });
    }

    if (!config.openaiApiKey) {
      return reply.code(503).send({ error: 'Translation service not configured' });
    }

    const systemPrompt = [
      `You are a professional translator. Translate from ${body.source_lang} to ${body.target_lang}.`,
      'Return ONLY a JSON array of translated strings in the same order as input.',
      'Preserve any interpolation variables like {{name}} or {count} exactly.',
      'Keep HTML tags intact if present.',
      body.context ? `Context: ${body.context}` : '',
    ].filter(Boolean).join('\n');

    const userContent = JSON.stringify(body.texts.map((t) => t.text));

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: process.env.TRANSLATE_MODEL ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return reply.code(502).send({ error: 'Translation API error' });
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const rawContent = data.choices?.[0]?.message?.content ?? '[]';
    let translations: string[];
    try {
      translations = JSON.parse(rawContent);
      if (!Array.isArray(translations)) throw new Error('Not an array');
    } catch {
      return reply.code(502).send({ error: 'Failed to parse translation response' });
    }

    const results = body.texts.map((t, i) => ({
      key: t.key ?? null,
      original: t.text,
      translated: translations[i] ?? t.text,
    }));

    return reply.send({
      translations: results,
      source_lang: body.source_lang,
      target_lang: body.target_lang,
      tokens_used: data.usage?.total_tokens ?? 0,
    });
  });
}
