-- =============================================================================
-- Occipitum Design Knowledge Base — Patterns + Anti-patterns
-- =============================================================================
-- Inovativní design patterny pro vizuální kortex AISHA.
-- Prohledávané přes mcp_search_knowledge_v2 s tagem 'occipitum'.
--
-- ⛔ IDENTITA (2026-10-05). Seed běží při KAŽDÉM nasazení (migrate → compile-seed →
-- db:seed). Do té doby tu řádky neměly id ani source_slug a končily
-- `ON CONFLICT DO NOTHING` bez cíle: na tabulce, kde jediný unikátní klíč bez slugu
-- je náhodné id, konflikt nikdy nenastal — naměřeno na čisté DB: 18 → 36 → 54 řádků
-- po 1./2./3. seedu, a s každou kopií nový chunk, embedding a audit.
-- Teď nese každá položka slug `occipitum-<titulek>` (skutečný přirozený klíč, drží ho
-- idx_knowledge_items_source_slug_locale_unique) a stabilní id md5('ki-' || slug) —
-- tentýž vzorec jako ostatní seedované znalosti. Opakovaný seed nic nepřidá.
-- Existující DB s kopiemi z doby před touto opravou slučuje heal
-- „seed-bez-duplicit" v aisha/db/heals.sql (běží před seedem); ponechané položce
-- doplní slug, takže na ni seed narazí i pod jejím původním id.
-- `ON CONFLICT DO NOTHING` je bez cíle záměrně a teď MÁ na čem zabrat: id (PK) na čisté
-- DB, slug tam, kde položku z doby před stabilním id převzal heal. Cíl (source_slug,
-- locale) se nepíše: index je částečný a jeho predikát se může měnit (vyhrazené zdroje
-- znalostí) — odvozený cíl by pak přestal sedět a seed by spadl. Hodnoty jsou literály
-- (id = md5('ki-' || slug) předpočítané), aby brána pgtap-fixture-nekoliduje-se-seedem
-- viděla klíče seedu.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Design Patterns — inovativní přístupy
-- ---------------------------------------------------------------------------

INSERT INTO public.knowledge_items (
  id, source_type, source_slug, locale,
  title, summary, body_markdown, item_type, category, ai_context_tags, is_verified
) VALUES
(
  '1350dab4-be1e-4851-9f5b-37af581c6901', 'manual', 'occipitum-editorial-grid-layout', 'global',
  'Editorial Grid Layout',
  'Asymetrická sazba inspirovaná tiskovými magazíny — velké whitespace, dramatické řezy, text jako vizuální prvek.',
  E'## Editorial Grid\n\nMísto symetrických 3-sloupcových gridů použij:\n- Asymetrické poměry (2:5, 1:3:2)\n- Text přetékající přes obrázky\n- Nadpisy jako celoplošný vizuální prvek\n- Negativní prostor jako aktivní designový element\n\n### GrapeJS implementace\nPoužij `gjs-row` s custom column ratios. CSS Grid s `grid-template-columns: 2fr 5fr`.\n\n### Emocionální účinek\nSofistikace, důvěra, profesionalita. Evokuje kvalitní print publikace.',
  'playbook', 'occipitum',
  ARRAY['web', 'layout', 'editorial', 'asymmetric', 'occipitum'],
  true
),
(
  '2fe094f5-54d9-cd48-4449-808faa14e955', 'manual', 'occipitum-kinetic-typography-hero', 'global',
  'Kinetic Typography Hero',
  'Animovaný text jako hlavní vizuální prvek místo statického hero obrázku — text se stává médiem.',
  E'## Kinetic Typography\n\nNadpis není jen informace — je to zážitek:\n- CSS scroll-driven animace (scroll-timeline)\n- Text reveal s clip-path / mask\n- Proměnné fonty (font-variation-settings) reagující na scroll\n- Letter-spacing animace při hoveru\n\n### GrapeJS implementace\nCustom component s `data-animate="kinetic"` atributem. CSS keyframes inline.\n\n### Emocionální účinek\nModernost, dynamičnost, inovace. Okamžitě odlišuje od statických webů.',
  'playbook', 'occipitum',
  ARRAY['web', 'typography', 'animation', 'hero', 'bold', 'occipitum'],
  true
),
(
  'ed2f54e1-9806-bb24-7bd5-d79e5ea42dfa', 'manual', 'occipitum-scroll-driven-storytelling', 'global',
  'Scroll-Driven Storytelling',
  'Celá stránka je příběh odhalovaný scrollem — každá sekce je akt, ne informační blok.',
  E'## Scroll Storytelling\n\nMísto sekcí Hero→About→Features→CTA:\n- Narativní struktura: konflikt → cesta → řešení → transformace\n- Parallax a fade-in časované ke scroll pozici\n- Horizontální scroll sekce pro dramatický moment\n- Full-bleed obrázky jako meziapty\n\n### GrapeJS implementace\nSekvenční `data-scroll-act="1..5"` atributy. IntersectionObserver pro reveal.\n\n### Emocionální účinek\nZapojení, zvědavost, emotional investment. Uživatel se stává čtenářem.',
  'playbook', 'occipitum',
  ARRAY['web', 'scroll', 'storytelling', 'narrative', 'immersive', 'occipitum'],
  true
),
(
  'f537dc98-a71b-81f0-6027-14a819d204df', 'manual', 'occipitum-brutalist-authenticity', 'global',
  'Brutalist Authenticity',
  'Raw, nefiltrovaný vizuální jazyk — system fonty, vysoký kontrast, žádné gradienty, záměrná nedokonalost.',
  E'## Brutalist Web Design\n\nKdyž značka je autentická a nebojí se:\n- Monospace / system fonty\n- Hrubé bordery (4px+ solid)\n- Harsh color blocking (černá/bílá + 1 accent)\n- Záměrně "nedokonalé" zarovnání\n- Viditelná struktura (grid lines, raw components)\n\n### GrapeJS implementace\nMinimální CSS. Žádné shadows, žádné rounded corners. `border: 4px solid currentColor`.\n\n### Emocionální účinek\nAutenticita, transparentnost, důvěra. Anti-corporate postoj.',
  'playbook', 'occipitum',
  ARRAY['web', 'brutalism', 'raw', 'authentic', 'bold', 'occipitum'],
  true
),
(
  'de1cd5ec-c2b6-da1c-dd4e-8cc28eed058d', 'manual', 'occipitum-bento-grid-dashboard', 'global',
  'Bento Grid Dashboard',
  'Modular dashboard styl inspirovaný Apple Bento — karty různých velikostí grupované sémanticky.',
  E'## Bento Grid\n\nMísto lineárního scrollu:\n- CSS Grid s auto-fit a span variací\n- Karty mají vlastní micro-interakce\n- Hover = expand / reveal more\n- Sémantické grupování (ne jen layout)\n\n### GrapeJS implementace\n`display: grid; grid-auto-flow: dense` s numbered span classes.\n\n### Emocionální účinek\nOrganizovanost, přehlednost, premium feel. Desktop-first richness.',
  'playbook', 'occipitum',
  ARRAY['web', 'bento', 'grid', 'dashboard', 'modular', 'occipitum'],
  true
),
(
  'e70097f9-ab0d-4c8a-2311-f06ba0aa536a', 'manual', 'occipitum-immersive-color-gradient-flow', 'global',
  'Immersive Color Gradient Flow',
  'Plynulé barevné přechody řízené scrollem — stránka dýchá barvami dle nálady obsahu.',
  E'## Gradient Flow\n\nBarvy nejsou statické — mění se s kontextem:\n- CSS `@property` animace gradientů\n- Scroll-driven hue rotation\n- Sekce-specifický mood: teplé barvy pro testimonials, chladné pro data\n- Mesh gradients přes `background-blend-mode`\n\n### GrapeJS implementace\n`data-mood="warm|cool|neutral"` atribut na sekcích. CSS proměnné `--section-hue`.\n\n### Emocionální účinek\nHarmonie, organičnost, živost. Stránka působí jako živá.',
  'playbook', 'occipitum',
  ARRAY['web', 'color', 'gradient', 'immersive', 'mood', 'occipitum'],
  true
),
(
  '0d5ba9a3-7dfd-48e1-9261-ce53462897f2', 'manual', 'occipitum-split-screen-dialogue', 'global',
  'Split-Screen Dialogue',
  'Obrazovka rozdělená vertikálně nebo diagonálně — dva pohledy, jeden příběh.',
  E'## Split-Screen Design\n\nKdyž existuje kontrast nebo dialog:\n- 50/50 vertikální split s kontrastními barvami\n- Diagonální řez (CSS clip-path / `polygon()`)\n- Jedna strana text, druhá vizuál — ale prohazují se\n- Hover = jedna strana expanduje (CSS transition)\n\n### GrapeJS implementace\nDvě `gjs-cell` s clip-path. Hover trigger přes CSS `:hover` + sibling selector.\n\n### Emocionální účinek\nDramatičnost, srovnání, rozhodování. Perfektní pro "before/after" nebo duální nabídky.',
  'playbook', 'occipitum',
  ARRAY['web', 'split-screen', 'contrast', 'dialogue', 'dramatic', 'occipitum'],
  true
),
(
  '9d75938a-f8cb-45c7-a723-112bf80cdff9', 'manual', 'occipitum-micro-interaction-personality', 'global',
  'Micro-Interaction Personality',
  'Drobné animace na hover/click/scroll které dávají webu charakter a lidskost.',
  E'## Micro-Interactions\n\nDetail, který dělá zážitek:\n- Button hover: scale + shadow + color shift (ne jen underline)\n- Scroll: progress bar v navigaci\n- Load: skeleton → content s stagger animací\n- Error: shake + haptic feedback pattern\n- Success: confetti / check pulse\n\n### GrapeJS implementace\nCSS `@keyframes` na component level. `data-interaction="bounce|pulse|shake"` atributy.\n\n### Emocionální účinek\nPříjemnost, pozornost k detailu, lidskost. Web působí "živě".',
  'playbook', 'occipitum',
  ARRAY['web', 'micro-interaction', 'animation', 'personality', 'detail', 'occipitum'],
  true
),
(
  'c3e5de2b-bba8-f092-bd8c-5790bd1fb491', 'manual', 'occipitum-full-bleed-photography-narrative', 'global',
  'Full-Bleed Photography Narrative',
  'Fotografie jako dominantní storytelling médium — text je sekundární, obraz vede.',
  E'## Photography-First Design\n\nKdyž značka má silný vizuální příběh:\n- Full-viewport obrázky (100vw × 100vh)\n- Text overlay s backdrop-filter nebo text-shadow\n- Ken Burns efekt (subtle zoom na scroll)\n- Lightbox gallery s swipe gestures\n\n### GrapeJS implementace\n`object-fit: cover` na `gjs-image`. `aspect-ratio` enforcement.\n\n### Emocionální účinek\nInspirace, touha, aspirace. Perfektní pro lifestyle brandy.',
  'playbook', 'occipitum',
  ARRAY['web', 'photography', 'fullbleed', 'visual', 'lifestyle', 'occipitum'],
  true
),
(
  '2a3483ec-52eb-ecdd-ac94-5b46143814c5', 'manual', 'occipitum-conversational-interface-landing', 'global',
  'Conversational Interface Landing',
  'Landing page jako rozhovor — progresivní odhalování obsahu formou otázek a odpovědí.',
  E'## Conversational Landing\n\nMísto klasických sekcí:\n- "Co hledáte?" → dynamický obsah dle reakce\n- Typewriter efekt pro otázky\n- Branching content (mini decision tree)\n- CTA emerguje z konverzace, není vnucená\n\n### GrapeJS implementace\nCustom `data-conversation-step` component. CSS transitions mezi stavy.\n\n### Emocionální účinek\nPersonalizace, engagement, respekt k uživateli. Web se ptá místo aby mluvil.',
  'playbook', 'occipitum',
  ARRAY['web', 'conversational', 'interactive', 'personalized', 'occipitum'],
  true
),
(
  'f202f540-04a4-b2c9-8254-f32a77dd911b', 'manual', 'occipitum-organic-shapes-and-blob-morphing', 'global',
  'Organic Shapes and Blob Morphing',
  'Měkké organické tvary místo ostrých obdélníků — blob SVG, wave dividers, amorfní pozadí.',
  E'## Organic Shapes\n\nLidský mozek je přitahován organickými tvary:\n- SVG blob generátory pro sekční pozadí\n- Wave separátory místo rovných linií\n- Border-radius variace (30% 70% 70% 30% / 30% 30% 70% 70%)\n- Morphing animace mezi blob stavy\n\n### GrapeJS implementace\nInline SVG s `<path>` a CSS `d` animací. Custom shape divider component.\n\n### Emocionální účinek\nPřátelskost, přirozenost, měkkost. Odstraňuje rigiditu "korporátního" designu.',
  'playbook', 'occipitum',
  ARRAY['web', 'organic', 'blob', 'shapes', 'friendly', 'occipitum'],
  true
),
(
  'ca6b1783-c415-ccfd-fff6-74907fb4e9c2', 'manual', 'occipitum-dark-mode-first-luxury', 'global',
  'Dark Mode First Luxury',
  'Tmavé pozadí jako základ luxusního dojmu — zlato/stříbro akcenty, minimální text, maximální whitespace.',
  E'## Dark Luxury\n\nKdyž značka aspiruje na premium segment:\n- Pozadí #0A0A0F až #1A1A2E\n- Akcentní barvy: zlato (#C4A24E), měď (#B87333), stříbro (#C0C0C0)\n- Ultra-thin fonty (font-weight: 200–300)\n- Generous spacing (padding: 8rem+)\n- Subtle glow efekty (box-shadow s transparentní akcentní barvou)\n\n### GrapeJS implementace\nCSS proměnné `--bg-primary: #0A0A0F`. Prefers-color-scheme ignorujeme — dark je designový záměr.\n\n### Emocionální účinek\nExkluzivita, elegance, důvěra. Premium cena se stává oprávněnou.',
  'playbook', 'occipitum',
  ARRAY['web', 'dark', 'luxury', 'premium', 'elegant', 'occipitum'],
  true
)
-- Bez cíle záměrně: řádek nese DVA skutečné klíče — id (PK) a slug (částečný unikátní
-- index). Na čisté DB zabere id, na DB s položkou z doby před stabilním id (heal jí
-- doplnil slug) zabere slug.
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Design Anti-patterns — explicitní blacklist
-- ---------------------------------------------------------------------------

INSERT INTO public.knowledge_items (
  id, source_type, source_slug, locale,
  title, summary, body_markdown, item_type, category, ai_context_tags, is_verified
) VALUES
(
  '41a52c99-9d7e-c168-a2c3-c4d000bd8e16', 'manual', 'occipitum-antipattern-generic-hero-cta-button', 'global',
  'ANTIPATTERN: Generic Hero + CTA Button',
  'Centered headline + subtitle + single CTA button na obrázkovém pozadí — nejnudnější a nejkopírovanější vzor na webu.',
  E'## Proč je to špatné\n\n90% webů začíná identicky: velký obrázek, centrovaný nadpis, podnadpis, tlačítko "Začít". Uživatel to vidí 100× týdně a okamžitě scroll-past.\n\n## Co místo toho\n- Kinetic Typography Hero\n- Split-Screen Dialogue\n- Conversational Interface Landing\n- Full-Bleed Photography s narativem',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'hero', 'generic', 'boring', 'occipitum'],
  true
),
(
  '988b7f5b-0b8a-387c-ff17-4608c81d326b', 'manual', 'occipitum-antipattern-hamburger-menu-everywhere', 'global',
  'ANTIPATTERN: Hamburger Menu Everywhere',
  'Hamburger menu na desktopu — skrývá navigaci zbytečně, snižuje engagement.',
  E'## Proč je to špatné\n\nHamburger menu bylo navrženo pro mobilní zařízení kde není místo. Na desktopu skrývá důležité odkazy za extra klik.\n\n## Co místo toho\n- Inline text navigace s hover reveal\n- Side rail navigace (sticky, visible)\n- Breadcrumb-free: kontextová navigace v obsahu\n- Command palette (Cmd+K) pro power users',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'hamburger', 'navigation', 'desktop', 'occipitum'],
  true
),
(
  'accd4ca0-4b40-a4dc-b4bf-077911e833dd', 'manual', 'occipitum-antipattern-cookie-cutter-card-grid', 'global',
  'ANTIPATTERN: Cookie-Cutter Card Grid',
  'Identické karty v 3-sloupcovém gridu na opakování — produkty, features, team. Nulová vizuální hierarchie.',
  E'## Proč je to špatné\n\nKdyž všechno má stejnou vizuální váhu, nic nemá váhu. Grid identických karet je defaultní "nemám nápad" layout.\n\n## Co místo toho\n- Bento Grid s variabilními velikostmi\n- Editorial layout s featured item\n- Carousel s micro-interactions\n- Stacked cards s parallax offset',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'cards', 'grid', 'uniform', 'occipitum'],
  true
),
(
  'fe2bd77b-0581-0af0-ede6-cef59b8e56a7', 'manual', 'occipitum-antipattern-popup-flow-pro-everything', 'global',
  'ANTIPATTERN: Popup Flow pro Everything',
  'Modal/popup pro objednávky, registrace, cookie consent, newsletter — uživatel je bombardován.',
  E'## Proč je to špatné\n\nKaždý popup přerušuje flow. Řetězení popupů (cookie → newsletter → akce → age gate) je UX katastrofa.\n\n## Co místo toho\n- Inline forms integrované do obsahu\n- Slide-in panels (Sheet component) místo modálů\n- Progressive disclosure — obsah se odhaluje postupně\n- Single cookie banner → preference center na dedikované stránce',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'popup', 'modal', 'intrusive', 'occipitum'],
  true
),
(
  'bec34a32-fa98-539f-0f60-fc620cfaebc6', 'manual', 'occipitum-antipattern-breadcrumb-navigation-clutter', 'global',
  'ANTIPATTERN: Breadcrumb Navigation Clutter',
  'Drobečková navigace viditelná na každé stránce — vizuální šum, redundantní s URL.',
  E'## Proč je to špatné\n\nBreadcrumbs jsou relikt webů s 10+ úrovněmi hloubky. Na moderních SPA s flat routing jsou zbytečné a vizuálně znečišťují header.\n\n## Co místo toho\n- Kontextová "zpět" tlačítka\n- Side navigation s active state\n- URL-based orientace (čitelné slugy)\n- Section headers s navigačním kontextem',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'breadcrumb', 'navigation', 'clutter', 'occipitum'],
  true
),
(
  'fc3f95f8-22ea-95cb-fdd8-9370eb7aa1f5', 'manual', 'occipitum-antipattern-stock-photo-hero', 'global',
  'ANTIPATTERN: Stock Photo Hero',
  'Generická stock fotka usmívajících se lidí u počítačů — nula autenticity, instant distrust.',
  E'## Proč je to špatné\n\nUživatel okamžitě pozná stock fotku. "Skupina různorodých profesionálů koukajících na laptop" = ztráta důvěry.\n\n## Co místo toho\n- Autentické fotky (i nedokonalé > perfect stock)\n- Ilustrace s vlastním stylem\n- Abstract vizuály / pattern backgrounds\n- Kinetic Typography (text IS the visual)',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'stock-photo', 'generic', 'inauthentic', 'occipitum'],
  true
)
-- Bez cíle záměrně: řádek nese DVA skutečné klíče — id (PK) a slug (částečný unikátní
-- index). Na čisté DB zabere id, na DB s položkou z doby před stabilním id (heal jí
-- doplnil slug) zabere slug.
ON CONFLICT DO NOTHING;
