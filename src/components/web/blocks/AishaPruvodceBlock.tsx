/**
 * AishaPruvodceBlock — Runtime block for the AISHA first-visit guide
 * ("průvodce"): a 13-slide educational deck ending in a 5-question quiz.
 *
 * React port of the aisha.guru standalone pruvodce deck (private design
 * repo lib/pruvodce.{src.html,js}) — the web-artifact ingest sanitizer
 * strips <script>, so the interactivity lives here as a runtime block and
 * the GrapeJS page carries only the placeholder:
 *
 *   `<div data-runtime-block="aisha-pruvodce"
 *         data-block-config='{"skipHref":"/aisha"}'></div>`
 *
 * Slides 1-5 teach the mental model (context, model variety, knowledgebase,
 * cost tiers, use-cases); slides 7-11 quiz it; slide 12 scores ≥80 % as
 * "ready" and routes to the platform landing. All copy is i18n
 * (`pruvodce.*`, web segment) so the deck localizes like the rest of the
 * site. Internal navigation uses router links (SPA — no reload).
 *
 * Config:
 * - skipHref    target of "I'm a pro, skip" + result CTAs (default "/aisha")
 *
 * @module
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";

import "./aishaPruvodce.css";

// =====================================================
// Quiz definition (copy lives in i18n; correctness here)
// =====================================================

interface QuizOption {
  /** i18n key of the option label */
  textKey: string;
  correct: boolean;
}

interface QuizQuestion {
  questionKey: string;
  hintKey: string;
  options: QuizOption[];
}

const QUIZ: QuizQuestion[] = [
  {
    questionKey: "pruvodce.q1.question",
    hintKey: "pruvodce.q1.hint",
    options: [
      { textKey: "pruvodce.q1.a", correct: false },
      { textKey: "pruvodce.q1.b", correct: true },
      { textKey: "pruvodce.q1.c", correct: false },
      { textKey: "pruvodce.q1.d", correct: false },
    ],
  },
  {
    questionKey: "pruvodce.q2.question",
    hintKey: "pruvodce.q2.hint",
    options: [
      { textKey: "pruvodce.q2.a", correct: false },
      { textKey: "pruvodce.q2.b", correct: false },
      { textKey: "pruvodce.q2.c", correct: true },
      { textKey: "pruvodce.q2.d", correct: false },
    ],
  },
  {
    questionKey: "pruvodce.q3.question",
    hintKey: "pruvodce.q3.hint",
    options: [
      { textKey: "pruvodce.q3.a", correct: false },
      { textKey: "pruvodce.q3.b", correct: true },
      { textKey: "pruvodce.q3.c", correct: false },
      { textKey: "pruvodce.q3.d", correct: false },
    ],
  },
  {
    questionKey: "pruvodce.q4.question",
    hintKey: "pruvodce.q4.hint",
    options: [
      { textKey: "pruvodce.q4.a", correct: true },
      { textKey: "pruvodce.q4.b", correct: false },
      { textKey: "pruvodce.q4.c", correct: false },
      { textKey: "pruvodce.q4.d", correct: false },
    ],
  },
  {
    questionKey: "pruvodce.q5.question",
    hintKey: "pruvodce.q5.hint",
    options: [
      { textKey: "pruvodce.q5.a", correct: false },
      { textKey: "pruvodce.q5.b", correct: true },
      { textKey: "pruvodce.q5.c", correct: false },
      { textKey: "pruvodce.q5.d", correct: false },
    ],
  },
];

/** Slide indexes: 0 welcome · 1-5 lessons · 6 quiz intro · 7-11 questions · 12 result */
const TOTAL_SLIDES = 13;
const FIRST_QUIZ_SLIDE = 7;
const RESULT_SLIDE = TOTAL_SLIDES - 1;
const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

/** Map slide index → quiz question index (or null for non-quiz slides). */
function quizIndexForSlide(slide: number): number | null {
  if (slide >= FIRST_QUIZ_SLIDE && slide < FIRST_QUIZ_SLIDE + QUIZ.length) {
    return slide - FIRST_QUIZ_SLIDE;
  }
  return null;
}

// =====================================================
// Small presentational helpers
// =====================================================

/** Donkey line-art used twice on the "AI is a brilliant donkey" slide. */
function DonkeySvg({ genius }: { genius: boolean }) {
  const stroke = genius ? "var(--ap-accent)" : "rgba(255,255,255,0.5)";
  return (
    <svg viewBox="0 0 80 80" fill="none" stroke={stroke} strokeWidth="1.6" aria-hidden="true">
      <ellipse cx="40" cy="50" rx="22" ry="14" />
      <ellipse cx="58" cy="38" rx="10" ry="14" />
      <ellipse cx="55" cy="26" rx="2" ry="6" />
      <ellipse cx="62" cy="26" rx="2" ry="6" />
      <circle cx="61" cy="40" r="1.5" fill={stroke} />
      <line x1="64" y1="44" x2="68" y2="44" />
      <line x1="22" y1="60" x2="22" y2="72" />
      <line x1="34" y1="62" x2="34" y2="72" />
      <line x1="46" y1="62" x2="46" y2="72" />
      <line x1="56" y1="60" x2="56" y2="72" />
      {genius ? <path d="M40 12 L40 4 M44 16 L48 12 M36 16 L32 12" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** Provider cells on the "many models" slide (names are product facts, not copy). */
const MODEL_CELLS = [
  { provider: "OpenAI", lineKey: "pruvodce.s2.line_openai", tagKey: "pruvodce.s2.tag_universal" },
  { provider: "Anthropic", lineKey: "pruvodce.s2.line_anthropic", tagKey: "pruvodce.s2.tag_code" },
  { provider: "Google", lineKey: "pruvodce.s2.line_google", tagKey: "pruvodce.s2.tag_fast" },
  { provider: "Meta · Mistral · vLLM", lineKey: "pruvodce.s2.line_local", tagKey: "pruvodce.s2.tag_local" },
];

/** Cost-distribution rows on the "not everything needs the priciest model" slide. */
const DIST_ROWS = [
  { labelKey: "pruvodce.s4.row_greeting", width: "10%", color: "#88D6A8", tier: "Flash" },
  { labelKey: "pruvodce.s4.row_routine", width: "25%", color: "#C28BFF", tierKey: "pruvodce.s4.tier_local" },
  { labelKey: "pruvodce.s4.row_analysis", width: "55%", color: "var(--ap-accent)", tier: "Sonnet" },
  { labelKey: "pruvodce.s4.row_deep", width: "90%", color: "var(--ap-accent)", tier: "Opus" },
];

/** Use-case grid (icon paths inline; names/descriptions via i18n). */
const USECASES = [
  { nameKey: "pruvodce.s5.uc1_name", descKey: "pruvodce.s5.uc1_desc", icon: "M4 6h16M4 12h12M4 18h16" },
  { nameKey: "pruvodce.s5.uc2_name", descKey: "pruvodce.s5.uc2_desc", icon: "M16 18l6-6-6-6M8 6l-6 6 6 6" },
  {
    nameKey: "pruvodce.s5.uc3_name",
    descKey: "pruvodce.s5.uc3_desc",
    icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  },
  {
    nameKey: "pruvodce.s5.uc4_name",
    descKey: "pruvodce.s5.uc4_desc",
    icon: "M3 4h18v16H3zM3 10h18",
  },
  { nameKey: "pruvodce.s5.uc5_name", descKey: "pruvodce.s5.uc5_desc", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
  { nameKey: "pruvodce.s5.uc6_name", descKey: "pruvodce.s5.uc6_desc", icon: "M12 2v20M2 12h20" },
  {
    nameKey: "pruvodce.s5.uc7_name",
    descKey: "pruvodce.s5.uc7_desc",
    icon: "M12 12m-4 0a4 4 0 108 0 4 4 0 10-8 0M4 22v-2a8 8 0 0116 0v2",
  },
  { nameKey: "pruvodce.s5.uc8_name", descKey: "pruvodce.s5.uc8_desc", icon: "M3 3v18h18M7 14l4-4 4 4 5-5" },
];

const STATIC_RUNTIME_I18N_KEYS = [
  "pruvodce.aria.answered",
  "pruvodce.aria.deck",
  "pruvodce.aria.nav",
  "pruvodce.aria.next",
  "pruvodce.aria.prev",
  "pruvodce.quiz.counter",
  "pruvodce.quiz.evaluate",
  "pruvodce.quiz.next",
  "pruvodce.result.again_body",
  "pruvodce.result.again_title",
  "pruvodce.result.cta_anyway",
  "pruvodce.result.cta_anyway_soon",
  "pruvodce.result.cta_platform",
  "pruvodce.result.cta_restart",
  "pruvodce.result.eyebrow",
  "pruvodce.result.ready_body",
  "pruvodce.result.ready_title",
  "pruvodce.result.soon_body",
  "pruvodce.result.soon_title",
  "pruvodce.s0.body",
  "pruvodce.s0.cta_go",
  "pruvodce.s0.cta_skip",
  "pruvodce.s0.eyebrow",
  "pruvodce.s0.heading",
  "pruvodce.s1.arrow",
  "pruvodce.s1.body",
  "pruvodce.s1.caption",
  "pruvodce.s1.eyebrow",
  "pruvodce.s1.heading",
  "pruvodce.s1.lbl_dumb",
  "pruvodce.s1.lbl_genius",
  "pruvodce.s2.body",
  "pruvodce.s2.caption",
  "pruvodce.s2.eyebrow",
  "pruvodce.s2.heading",
  "pruvodce.s3.answer_with",
  "pruvodce.s3.answer_without",
  "pruvodce.s3.body",
  "pruvodce.s3.caption",
  "pruvodce.s3.eyebrow",
  "pruvodce.s3.heading",
  "pruvodce.s3.lbl_with",
  "pruvodce.s3.lbl_without",
  "pruvodce.s4.body",
  "pruvodce.s4.caption",
  "pruvodce.s4.eyebrow",
  "pruvodce.s4.heading",
  "pruvodce.s5.body",
  "pruvodce.s5.eyebrow",
  "pruvodce.s5.heading",
  "pruvodce.s6.body",
  "pruvodce.s6.cta_start",
  "pruvodce.s6.eyebrow",
  "pruvodce.s6.heading",
];

const RUNTIME_I18N_KEYS = Array.from(
  new Set([
    ...STATIC_RUNTIME_I18N_KEYS,
    ...QUIZ.flatMap((q) => [q.questionKey, q.hintKey, ...q.options.map((o) => o.textKey)]),
    ...MODEL_CELLS.flatMap((cell) => [cell.lineKey, cell.tagKey]),
    ...DIST_ROWS.flatMap((row) => [row.labelKey, "tierKey" in row && row.tierKey ? row.tierKey : ""]),
    ...USECASES.flatMap((uc) => [uc.nameKey, uc.descKey]),
  ].filter(Boolean)),
);

function interpolate(value: string, variables?: Record<string, unknown>): string {
  if (!variables) return value;
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name: string) => {
    const replacement = variables[name];
    return replacement === undefined || replacement === null ? match : String(replacement);
  });
}

// =====================================================
// Component
// =====================================================

/**
 * The guide deck. Self-contained slide navigation + quiz state; copy via
 * i18n; brand styling scoped under `.aisha-pruvodce` (aishaPruvodce.css).
 */
export default function AishaPruvodceBlock({ config }: RuntimeBlockProps) {
  const { t: staticT } = useTranslation();
  const dynamicTranslations = useDynamicTranslationsMap(RUNTIME_I18N_KEYS, "web", "en");
  const skipHref = typeof config.skipHref === "string" && config.skipHref ? config.skipHref : "/aisha";

  const t = (key: string, variables?: Record<string, unknown>): string => {
    const dynamicValue = dynamicTranslations[key];
    return dynamicValue !== undefined ? interpolate(dynamicValue, variables) : staticT(key, variables);
  };

  const trans = (key: string, components: Record<string, JSX.Element>) => {
    const dynamicValue = dynamicTranslations[key];
    return dynamicValue !== undefined ? (
      <Trans i18nKey={`runtime.${key}`} defaults={dynamicValue} components={components} />
    ) : (
      <Trans i18nKey={key} components={components} />
    );
  };

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, boolean>>({});
  const stageRef = useRef<HTMLDivElement>(null);

  const answeredCount = Object.keys(answers).length;
  const score = Object.values(answers).filter(Boolean).length;

  const go = (to: number) => {
    if (to < 0 || to >= TOTAL_SLIDES) return;
    setCurrent(to);
  };

  const next = () => {
    setCurrent((cur) => {
      const quizIdx = quizIndexForSlide(cur);
      // Gate: a quiz slide only advances once answered.
      if (quizIdx !== null && answers[quizIdx] === undefined) return cur;
      return cur + 1 >= TOTAL_SLIDES ? cur : cur + 1;
    });
  };

  const prev = () => go(current - 1);

  const restart = () => {
    setAnswers({});
    setCurrent(0);
  };

  const answer = (quizIdx: number, correct: boolean) => {
    setAnswers((prevAnswers) => {
      if (prevAnswers[quizIdx] !== undefined) return prevAnswers; // already answered
      return { ...prevAnswers, [quizIdx]: correct };
    });
  };

  // Keyboard navigation, scoped to the deck container (no document-wide hijack).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    }
  };

  // Keep the active slide in view when navigating on small screens.
  useEffect(() => {
    stageRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  }, [current]);

  const ready = score >= 4; // 4/5 = 80 %
  const soon = !ready && score >= 3;

  // =====================================================
  // Per-slide renderers
  // =====================================================

  const renderLessonCaption = (key: string) => <p className="ap-slide__caption">{t(key)}</p>;

  const renderQuizSlide = (quizIdx: number) => {
    const q = QUIZ[quizIdx];
    const answered = answers[quizIdx] !== undefined;
    return (
      <div className="ap-quiz">
        <span className="ap-quiz__qnum">{t("pruvodce.quiz.counter", { num: quizIdx + 1, total: QUIZ.length })}</span>
        <h2 className="ap-quiz__q">{t(q.questionKey)}</h2>
        <div className="ap-quiz__opts">
          {q.options.map((opt, i) => {
            const cls = [
              "ap-quiz__opt",
              answered ? "is-disabled" : "",
              answered && opt.correct ? "is-correct" : "",
              answered && !opt.correct ? "is-muted" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button key={opt.textKey} type="button" className={cls} onClick={() => answer(quizIdx, opt.correct)}>
                <span className="ap-quiz__opt-letter">{OPTION_LETTERS[i]}</span>
                <span className="ap-quiz__opt-text">{t(opt.textKey)}</span>
                <span className="ap-quiz__opt-mark" data-mark={answered ? (opt.correct ? "correct" : "wrong") : "idle"}>
                  {answered ? (opt.correct ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />) : "·"}
                </span>
              </button>
            );
          })}
        </div>
        <p className={`ap-quiz__hint ${answered ? "is-visible" : ""}`}>
          {trans(q.hintKey, { strong: <strong /> })}
        </p>
        <div className="ap-quiz__next-row">
          <button type="button" className={`ap-btn-slice ${answered ? "is-ready" : ""}`} onClick={next}>
            <span>{quizIdx === QUIZ.length - 1 ? t("pruvodce.quiz.evaluate") : t("pruvodce.quiz.next")}</span>
            <span className="ap-arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </div>
    );
  };

  const renderResult = () => (
    <div className="ap-result">
      <div className="ap-slide__eyebrow">{t("pruvodce.result.eyebrow")}</div>
      <p className="ap-result__score">
        <span>{score}</span>
        <span className="ap-result__of">/{QUIZ.length}</span>
      </p>
      <h2 className={`ap-result__verdict ${ready ? "is-ready" : "is-soon"}`}>
        {ready ? t("pruvodce.result.ready_title") : soon ? t("pruvodce.result.soon_title") : t("pruvodce.result.again_title")}
      </h2>
      <p className="ap-result__body">
        {ready ? t("pruvodce.result.ready_body") : soon ? t("pruvodce.result.soon_body") : t("pruvodce.result.again_body")}
      </p>
      <div className="ap-slide__cta-row">
        {ready ? (
          <Link to={skipHref} className="ap-btn-slice is-ready">
            <span>{t("pruvodce.result.cta_platform")}</span>
            <span className="ap-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        ) : (
          <>
            <button type="button" className="ap-btn-slice is-ready" onClick={restart}>
              <span>{t("pruvodce.result.cta_restart")}</span>
              <span className="ap-arrow" aria-hidden="true">
                →
              </span>
            </button>
            <Link to={skipHref} className="ap-btn-ghost">
              {soon ? t("pruvodce.result.cta_anyway_soon") : t("pruvodce.result.cta_anyway")}
            </Link>
          </>
        )}
      </div>
    </div>
  );

  const slides: React.ReactNode[] = [
    // ── 0 · Welcome ──
    <div key="s0" className="ap-slide__inner ap-slide__inner--center">
      <div className="ap-slide__eyebrow">{t("pruvodce.s0.eyebrow")}</div>
      <h1 className="ap-slide__h">
        {trans("pruvodce.s0.heading", { accent: <span className="ap-accent" />, br: <br /> })}
      </h1>
      <p className="ap-slide__body ap-slide__body--center">{t("pruvodce.s0.body")}</p>
      <div className="ap-slide__cta-row">
        <button type="button" className="ap-btn-slice is-ready" onClick={next}>
          <span>{t("pruvodce.s0.cta_go")}</span>
          <span className="ap-arrow" aria-hidden="true">
            →
          </span>
        </button>
        <Link to={skipHref} className="ap-btn-ghost">
          {t("pruvodce.s0.cta_skip")}
        </Link>
      </div>
    </div>,

    // ── 1 · Donkey / context ──
    <div key="s1" className="ap-slide__inner">
      <div className="ap-slide__eyebrow">{t("pruvodce.s1.eyebrow")}</div>
      <h2 className="ap-slide__h">
        {trans("pruvodce.s1.heading", { accent: <span className="ap-accent" />, br: <br /> })}
      </h2>
      <p className="ap-slide__body">
        {trans("pruvodce.s1.body", { strong: <strong /> })}
      </p>
      <div className="ap-viz">
        <div className="ap-donkey">
          <div className="ap-donkey__col">
            <DonkeySvg genius={false} />
            <span className="ap-donkey__lbl">{t("pruvodce.s1.lbl_dumb")}</span>
          </div>
          <div className="ap-donkey__arrow">{t("pruvodce.s1.arrow")}</div>
          <div className="ap-donkey__col">
            <DonkeySvg genius />
            <span className="ap-donkey__lbl ap-donkey__lbl--genius">{t("pruvodce.s1.lbl_genius")}</span>
          </div>
        </div>
      </div>
      {renderLessonCaption("pruvodce.s1.caption")}
    </div>,

    // ── 2 · Many models ──
    <div key="s2" className="ap-slide__inner">
      <div className="ap-slide__eyebrow">{t("pruvodce.s2.eyebrow")}</div>
      <h2 className="ap-slide__h">
        {trans("pruvodce.s2.heading", { accent: <span className="ap-accent" />, br: <br /> })}
      </h2>
      <p className="ap-slide__body">
        {trans("pruvodce.s2.body", { strong: <strong /> })}
      </p>
      <div className="ap-viz">
        <div className="ap-models">
          {MODEL_CELLS.map((cell) => (
            <div key={cell.provider} className="ap-models__cell">
              <span className="ap-models__provider">{cell.provider}</span>
              <span className="ap-models__line">{t(cell.lineKey)}</span>
              <span className="ap-models__tag">{t(cell.tagKey)}</span>
            </div>
          ))}
        </div>
      </div>
      {renderLessonCaption("pruvodce.s2.caption")}
    </div>,

    // ── 3 · Context / knowledgebase ──
    <div key="s3" className="ap-slide__inner">
      <div className="ap-slide__eyebrow">{t("pruvodce.s3.eyebrow")}</div>
      <h2 className="ap-slide__h">
        {trans("pruvodce.s3.heading", { accent: <span className="ap-accent" /> })}
      </h2>
      <p className="ap-slide__body">
        {trans("pruvodce.s3.body", { strong: <strong />, em: <em /> })}
      </p>
      <div className="ap-viz">
        <div className="ap-ctx">
          <div className="ap-ctx__side">
            <span className="ap-ctx__lbl">{t("pruvodce.s3.lbl_without")}</span>
            <span className="ap-ctx__answer">{t("pruvodce.s3.answer_without")}</span>
          </div>
          <div className="ap-ctx__arrow" aria-hidden="true">
            →
          </div>
          <div className="ap-ctx__side ap-ctx__side--right">
            <span className="ap-ctx__lbl">{t("pruvodce.s3.lbl_with")}</span>
            <span className="ap-ctx__answer">{t("pruvodce.s3.answer_with")}</span>
          </div>
        </div>
      </div>
      {renderLessonCaption("pruvodce.s3.caption")}
    </div>,

    // ── 4 · Cost distribution ──
    <div key="s4" className="ap-slide__inner">
      <div className="ap-slide__eyebrow">{t("pruvodce.s4.eyebrow")}</div>
      <h2 className="ap-slide__h">
        {trans("pruvodce.s4.heading", { accent: <span className="ap-accent" />, br: <br /> })}
      </h2>
      <p className="ap-slide__body">
        {trans("pruvodce.s4.body", { strong: <strong /> })}
      </p>
      <div className="ap-viz">
        <div className="ap-dist">
          {DIST_ROWS.map((row) => (
            <div key={row.labelKey} className="ap-dist__row">
              <strong>{t(row.labelKey)}</strong>
              <div className="ap-dist__bar">
                <span style={{ width: row.width, background: row.color }} />
              </div>
              <span className="ap-dist__pct">{"tierKey" in row && row.tierKey ? t(row.tierKey) : row.tier}</span>
            </div>
          ))}
        </div>
      </div>
      {renderLessonCaption("pruvodce.s4.caption")}
    </div>,

    // ── 5 · Use cases ──
    <div key="s5" className="ap-slide__inner">
      <div className="ap-slide__eyebrow">{t("pruvodce.s5.eyebrow")}</div>
      <h2 className="ap-slide__h">
        {trans("pruvodce.s5.heading", { accent: <span className="ap-accent" /> })}
      </h2>
      <p className="ap-slide__body">{t("pruvodce.s5.body")}</p>
      <div className="ap-viz">
        <div className="ap-usecases">
          {USECASES.map((uc) => (
            <div key={uc.nameKey} className="ap-usecase">
              <svg
                className="ap-usecase__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d={uc.icon} />
              </svg>
              <span className="ap-usecase__name">{t(uc.nameKey)}</span>
              <p className="ap-usecase__desc">{t(uc.descKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>,

    // ── 6 · Quiz intro ──
    <div key="s6" className="ap-slide__inner ap-slide__inner--center">
      <div className="ap-slide__eyebrow">{t("pruvodce.s6.eyebrow")}</div>
      <h2 className="ap-slide__h">
        {trans("pruvodce.s6.heading", { accent: <span className="ap-accent" />, br: <br /> })}
      </h2>
      <p className="ap-slide__body ap-slide__body--center">{t("pruvodce.s6.body")}</p>
      <div className="ap-slide__cta-row">
        <button type="button" className="ap-btn-slice is-ready" onClick={next}>
          <span>{t("pruvodce.s6.cta_start")}</span>
          <span className="ap-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>
    </div>,

    // ── 7-11 · Quiz ──
    ...QUIZ.map((_, i) => (
      <div key={`q${i}`} className="ap-slide__inner">
        {renderQuizSlide(i)}
      </div>
    )),

    // ── 12 · Result ──
    <div key="result" className="ap-slide__inner ap-slide__inner--center">
      {renderResult()}
    </div>,
  ];

  // =====================================================
  // Render
  // =====================================================

  return (
    <section
      className="aisha-pruvodce"
      aria-label={t("pruvodce.aria.deck")}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className="ap-stage" ref={stageRef}>
        <div className="ap-slide is-active" data-slide={current}>
          {slides[current]}
        </div>
      </div>

      <nav className="ap-nav" aria-label={t("pruvodce.aria.nav")}>
        <button
          type="button"
          className="ap-nav__arrow"
          onClick={prev}
          disabled={current === 0}
          aria-label={t("pruvodce.aria.prev")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="ap-progress" aria-hidden="true">
          {Array.from({ length: TOTAL_SLIDES }, (_, i) => (
            <div
              key={i}
              className={`ap-progress__step ${i < current ? "is-done" : ""} ${i === current ? "is-active" : ""}`}
            />
          ))}
        </div>
        <div className="ap-nav__right">
          <span className="ap-nav__counter">
            {current + 1} / {TOTAL_SLIDES}
          </span>
          <button
            type="button"
            className="ap-nav__arrow"
            onClick={next}
            disabled={
              current === RESULT_SLIDE ||
              (quizIndexForSlide(current) !== null && answers[quizIndexForSlide(current) as number] === undefined)
            }
            aria-label={t("pruvodce.aria.next")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </nav>

      {/* answered-progress live region for screen readers */}
      <span className="sr-only" aria-live="polite">
        {t("pruvodce.aria.answered", { answered: answeredCount, total: QUIZ.length })}
      </span>
    </section>
  );
}
