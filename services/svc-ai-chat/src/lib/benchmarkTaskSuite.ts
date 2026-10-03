/**
 * Quality benchmark task suite (SoT). Each task's `task_type` MUST match the resolver's
 * v_task_kind (aisha_resolve_clow_backend) for the score to feed ranking — 'chat' is the
 * default/dominant kind (get_adaptive_model_tiers is called with no arg → 'chat'). The
 * runner aggregates per (model, task_type) into ONE current ai_model_benchmarks row.
 * `expect` is the deterministic heuristic check; `rubric` guides the optional LLM judge.
 *
 * ⛔ ČEŠTINA (2026-09-13): sada byla jen anglická, takže AISHA vybírala modely podle
 * angličtiny, ačkoli její primární jazyk je čeština (INSIGHT_DEFAULT_LANG cs-CZ). Malé
 * lokální modely se v češtině liší výrazně víc než v angličtině (skloňování, diakritika).
 * Každý task_type proto nese úlohy OBOU jazyků téhož tvaru; agregát per (model, task_type)
 * je průměruje. Parita jazyků je hlídaná testem (benchmark-task-suite.unit.test.ts).
 * Očekávané odpovědi v češtině jsou v 1. pádě a zadání to výslovně žádá — heuristika
 * porovnává podřetězec, ne tvar slova.
 */
import type { BenchmarkTask } from './benchmarkScorer.js';

/** The canonical task_type the resolver + tiers query by default. Keep tasks on this. */
export const DEFAULT_TASK_TYPE = 'chat';

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: 'factual-recall',
    task_type: DEFAULT_TASK_TYPE,
    language: 'en',
    prompt: 'What is the capital city of France? Answer with just the city name.',
    expect: { contains: 'Paris' },
    rubric: 'Is the answer factually correct (Paris) and concise?',
  },
  {
    id: 'instruction-follow',
    task_type: DEFAULT_TASK_TYPE,
    language: 'en',
    prompt: 'Reply with exactly this single word and nothing else: ACKNOWLEDGED',
    expect: { contains: 'ACKNOWLEDGED' },
    rubric: 'Did the model follow the exact-output instruction without extra text?',
  },
  {
    id: 'arithmetic-reason',
    task_type: DEFAULT_TASK_TYPE,
    language: 'en',
    prompt: 'A train travels 60 km in 1.5 hours. What is its average speed in km/h? Answer with just the number.',
    expect: { contains: '40' },
    rubric: 'Is the numeric reasoning correct (40) and the answer concise?',
  },
  {
    id: 'structured-output',
    task_type: DEFAULT_TASK_TYPE,
    language: 'en',
    prompt: 'Return exactly the three additive primary colors of light as a JSON array of lowercase strings, nothing else.',
    expect: { jsonArrayMinLength: 3 },
    rubric: 'Is the output a valid JSON array naming the primary colors, with no surrounding prose?',
  },

  // ── chat × čeština — týž tvar jako anglické úlohy výš + jedna na tvarosloví ──
  {
    id: 'cs-factual-recall',
    task_type: DEFAULT_TASK_TYPE,
    language: 'cs',
    prompt: 'Jaké je hlavní město Francie? Odpověz pouze názvem města v prvním pádě.',
    expect: { contains: 'Paříž' },
    rubric: 'Je odpověď věcně správná (Paříž), česky, s diakritikou a stručná?',
  },
  {
    id: 'cs-instruction-follow',
    task_type: DEFAULT_TASK_TYPE,
    language: 'cs',
    prompt: 'Odpověz přesně tímto jedním slovem a ničím jiným: POTVRZENO',
    expect: { contains: 'POTVRZENO' },
    rubric: 'Dodržel model přesný výstup bez dalšího textu?',
  },
  {
    id: 'cs-arithmetic-reason',
    task_type: DEFAULT_TASK_TYPE,
    language: 'cs',
    prompt: 'Vlak ujede 60 km za 1,5 hodiny. Jaká je jeho průměrná rychlost v km/h? Odpověz pouze číslem.',
    expect: { contains: '40' },
    rubric: 'Je výpočet správný (40) a odpověď stručná?',
  },
  {
    id: 'cs-inflection',
    task_type: DEFAULT_TASK_TYPE,
    language: 'cs',
    prompt: "Doplň slovo v závorce ve správném tvaru a vypiš pouze ten tvar: 'Bez (voda) nepřežijeme.'",
    expect: { contains: 'vody' },
    rubric: 'Je tvar gramaticky správný (2. pád: vody) a vypsaný bez dalšího textu?',
  },
  {
    id: 'cs-structured-output',
    task_type: DEFAULT_TASK_TYPE,
    language: 'cs',
    prompt: 'Vrať přesně tři základní aditivní barvy světla jako JSON pole českých slov malými písmeny, nic jiného.',
    expect: { jsonArrayMinLength: 3 },
    rubric: 'Je výstup platné JSON pole se třemi barvami (česky) bez okolního textu?',
  },

  // ── classification (task_type matches resolver v_task_kind 'classification', used by
  //    7 callers) — tests label discrimination; binds to is_chat_capable (text in/out).
  {
    id: 'sentiment-classify',
    task_type: 'classification',
    language: 'en',
    prompt:
      "Classify the sentiment of this review as exactly one lowercase word — positive, negative, or neutral — and output only that word: 'The product broke after two days, very disappointed.'",
    expect: { contains: 'negative' },
    rubric: 'Is the sentiment label correct (negative) and the output just the single label word?',
  },
  {
    id: 'topic-classify',
    task_type: 'classification',
    language: 'en',
    prompt:
      "Pick the single best category for this headline from exactly: sports, politics, technology, health. Output only the one lowercase word. Headline: 'New AI chip doubles inference speed.'",
    expect: { contains: 'technology' },
    rubric: 'Is the category correct (technology) and the output just the one label?',
  },
  {
    id: 'cs-sentiment-classify',
    task_type: 'classification',
    language: 'cs',
    prompt:
      "Urči sentiment této recenze jedním slovem malými písmeny — pozitivní, negativní, nebo neutrální — a vypiš jen to slovo: 'Výrobek se po dvou dnech rozbil, jsem velmi zklamaný.'",
    expect: { contains: 'negativní' },
    rubric: 'Je štítek správný (negativní) a výstup jen to jedno slovo?',
  },
  {
    id: 'cs-topic-classify',
    task_type: 'classification',
    language: 'cs',
    prompt:
      "Vyber jedinou nejvhodnější kategorii pro tento titulek přesně z: sport, politika, technologie, zdraví. Vypiš jen to jedno slovo malými písmeny. Titulek: 'Nový čip pro umělou inteligenci zdvojnásobil rychlost inference.'",
    expect: { contains: 'technologie' },
    rubric: 'Je kategorie správná (technologie) a výstup jen ten jeden štítek?',
  },

  // ── reasoning (task_type 'reasoning') — multi-step logic; the bench here naturally
  //    reflects is_reasoning fit (a stronger reasoner scores higher on these).
  {
    id: 'transitive-order',
    task_type: 'reasoning',
    language: 'en',
    prompt: 'Alice is older than Bob. Bob is older than Carol. Who is the youngest? Answer with just the name.',
    expect: { contains: 'Carol' },
    rubric: 'Is the transitive deduction correct (Carol) and concise?',
  },
  {
    id: 'rate-trap',
    task_type: 'reasoning',
    language: 'en',
    prompt:
      'If 3 machines make 3 widgets in 3 minutes, how many minutes do 100 machines take to make 100 widgets? Answer with just the number.',
    expect: { contains: '3' },
    rubric: 'Is the rate reasoning correct (3 — a classic trap, the wrong answer is 100) and is the output concise?',
  },
  {
    id: 'cs-transitive-order',
    task_type: 'reasoning',
    language: 'cs',
    prompt: 'Alena je starší než Bohdan. Bohdan je starší než Cyril. Kdo je nejmladší? Odpověz pouze jménem v prvním pádě.',
    expect: { contains: 'Cyril' },
    rubric: 'Je dedukce správná (Cyril) a odpověď stručná?',
  },
  {
    id: 'cs-rate-trap',
    task_type: 'reasoning',
    language: 'cs',
    prompt:
      'Když 5 strojů vyrobí 5 součástek za 5 minut, za kolik minut vyrobí 100 strojů 100 součástek? Odpověz pouze číslem.',
    expect: { contains: '5' },
    rubric: 'Je úvaha o rychlosti správná (5 — past, chybná odpověď je 100) a odpověď stručná?',
  },

  // ── extraction (task_type 'extraction') — pull structured fields from prose;
  //    containsAll gives per-field partial credit.
  {
    id: 'field-extract',
    task_type: 'extraction',
    language: 'en',
    prompt:
      'Extract the person\'s name and the origin city from this sentence as a compact JSON object with keys "name" and "city", nothing else: \'Maria flew from Prague to attend the summit.\'',
    expect: { containsAll: ['Maria', 'Prague'] },
    rubric: 'Are BOTH fields extracted correctly (Maria, Prague) as clean JSON with no surrounding prose?',
  },
  {
    id: 'number-extract',
    task_type: 'extraction',
    language: 'en',
    prompt:
      "List every number mentioned in this text as a JSON array of integers, nothing else: 'We sold 12 units on Monday and 7 on Tuesday.'",
    expect: { jsonArrayMinLength: 2 },
    rubric: 'Are both numbers (12 and 7) extracted as a JSON array of integers with no prose?',
  },
  {
    id: 'cs-field-extract',
    task_type: 'extraction',
    language: 'cs',
    prompt:
      'Z této věty vytáhni jméno osoby a město, odkud přiletěla, jako kompaktní JSON objekt s klíči "jmeno" a "mesto" (obě hodnoty v prvním pádě), nic jiného: \'Marie přiletěla z Brna na konferenci.\'',
    // „Brno" v 1. pádě — věta nese „z Brna"; model, který jen opíše tvar z textu, bod za město nedostane.
    expect: { containsAll: ['Marie', 'Brno'] },
    rubric: 'Jsou OBĚ hodnoty správně a v prvním pádě (Marie, Brno) jako čistý JSON bez okolního textu?',
  },
  {
    id: 'cs-number-extract',
    task_type: 'extraction',
    language: 'cs',
    prompt:
      "Vypiš všechna čísla zmíněná v textu jako JSON pole celých čísel, nic jiného: 'V pondělí jsme prodali 12 kusů a v úterý 7.'",
    expect: { jsonArrayMinLength: 2 },
    rubric: 'Jsou obě čísla (12 a 7) jako JSON pole celých čísel bez okolního textu?',
  },
];
