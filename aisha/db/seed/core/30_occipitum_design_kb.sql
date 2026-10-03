-- =============================================================================
-- Occipitum Design Knowledge Base — Patterns + Anti-patterns
-- =============================================================================
-- Inovativní design patterny pro vizuální kortex AISHA.
-- Prohledávané přes mcp_search_knowledge_v2 s tagem 'occipitum'.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Design Patterns — inovativní přístupy
-- ---------------------------------------------------------------------------

INSERT INTO public.knowledge_items (title, summary, body_markdown, item_type, category, ai_context_tags, is_verified)
VALUES
(
  'Editorial Grid Layout',
  'Asymetrická sazba inspirovaná tiskovými magazíny — velké whitespace, dramatické řezy, text jako vizuální prvek.',
  E'## Editorial Grid\n\nMísto symetrických 3-sloupcových gridů použij:\n- Asymetrické poměry (2:5, 1:3:2)\n- Text přetékající přes obrázky\n- Nadpisy jako celoplošný vizuální prvek\n- Negativní prostor jako aktivní designový element\n\n### GrapeJS implementace\nPoužij `gjs-row` s custom column ratios. CSS Grid s `grid-template-columns: 2fr 5fr`.\n\n### Emocionální účinek\nSofistikace, důvěra, profesionalita. Evokuje kvalitní print publikace.',
  'playbook', 'occipitum',
  ARRAY['web', 'layout', 'editorial', 'asymmetric', 'occipitum'],
  true
),
(
  'Kinetic Typography Hero',
  'Animovaný text jako hlavní vizuální prvek místo statického hero obrázku — text se stává médiem.',
  E'## Kinetic Typography\n\nNadpis není jen informace — je to zážitek:\n- CSS scroll-driven animace (scroll-timeline)\n- Text reveal s clip-path / mask\n- Proměnné fonty (font-variation-settings) reagující na scroll\n- Letter-spacing animace při hoveru\n\n### GrapeJS implementace\nCustom component s `data-animate="kinetic"` atributem. CSS keyframes inline.\n\n### Emocionální účinek\nModernost, dynamičnost, inovace. Okamžitě odlišuje od statických webů.',
  'playbook', 'occipitum',
  ARRAY['web', 'typography', 'animation', 'hero', 'bold', 'occipitum'],
  true
),
(
  'Scroll-Driven Storytelling',
  'Celá stránka je příběh odhalovaný scrollem — každá sekce je akt, ne informační blok.',
  E'## Scroll Storytelling\n\nMísto sekcí Hero→About→Features→CTA:\n- Narativní struktura: konflikt → cesta → řešení → transformace\n- Parallax a fade-in časované ke scroll pozici\n- Horizontální scroll sekce pro dramatický moment\n- Full-bleed obrázky jako meziapty\n\n### GrapeJS implementace\nSekvenční `data-scroll-act="1..5"` atributy. IntersectionObserver pro reveal.\n\n### Emocionální účinek\nZapojení, zvědavost, emotional investment. Uživatel se stává čtenářem.',
  'playbook', 'occipitum',
  ARRAY['web', 'scroll', 'storytelling', 'narrative', 'immersive', 'occipitum'],
  true
),
(
  'Brutalist Authenticity',
  'Raw, nefiltrovaný vizuální jazyk — system fonty, vysoký kontrast, žádné gradienty, záměrná nedokonalost.',
  E'## Brutalist Web Design\n\nKdyž značka je autentická a nebojí se:\n- Monospace / system fonty\n- Hrubé bordery (4px+ solid)\n- Harsh color blocking (černá/bílá + 1 accent)\n- Záměrně "nedokonalé" zarovnání\n- Viditelná struktura (grid lines, raw components)\n\n### GrapeJS implementace\nMinimální CSS. Žádné shadows, žádné rounded corners. `border: 4px solid currentColor`.\n\n### Emocionální účinek\nAutenticita, transparentnost, důvěra. Anti-corporate postoj.',
  'playbook', 'occipitum',
  ARRAY['web', 'brutalism', 'raw', 'authentic', 'bold', 'occipitum'],
  true
),
(
  'Bento Grid Dashboard',
  'Modular dashboard styl inspirovaný Apple Bento — karty různých velikostí grupované sémanticky.',
  E'## Bento Grid\n\nMísto lineárního scrollu:\n- CSS Grid s auto-fit a span variací\n- Karty mají vlastní micro-interakce\n- Hover = expand / reveal more\n- Sémantické grupování (ne jen layout)\n\n### GrapeJS implementace\n`display: grid; grid-auto-flow: dense` s numbered span classes.\n\n### Emocionální účinek\nOrganizovanost, přehlednost, premium feel. Desktop-first richness.',
  'playbook', 'occipitum',
  ARRAY['web', 'bento', 'grid', 'dashboard', 'modular', 'occipitum'],
  true
),
(
  'Immersive Color Gradient Flow',
  'Plynulé barevné přechody řízené scrollem — stránka dýchá barvami dle nálady obsahu.',
  E'## Gradient Flow\n\nBarvy nejsou statické — mění se s kontextem:\n- CSS `@property` animace gradientů\n- Scroll-driven hue rotation\n- Sekce-specifický mood: teplé barvy pro testimonials, chladné pro data\n- Mesh gradients přes `background-blend-mode`\n\n### GrapeJS implementace\n`data-mood="warm|cool|neutral"` atribut na sekcích. CSS proměnné `--section-hue`.\n\n### Emocionální účinek\nHarmonie, organičnost, živost. Stránka působí jako živá.',
  'playbook', 'occipitum',
  ARRAY['web', 'color', 'gradient', 'immersive', 'mood', 'occipitum'],
  true
),
(
  'Split-Screen Dialogue',
  'Obrazovka rozdělená vertikálně nebo diagonálně — dva pohledy, jeden příběh.',
  E'## Split-Screen Design\n\nKdyž existuje kontrast nebo dialog:\n- 50/50 vertikální split s kontrastními barvami\n- Diagonální řez (CSS clip-path / `polygon()`)\n- Jedna strana text, druhá vizuál — ale prohazují se\n- Hover = jedna strana expanduje (CSS transition)\n\n### GrapeJS implementace\nDvě `gjs-cell` s clip-path. Hover trigger přes CSS `:hover` + sibling selector.\n\n### Emocionální účinek\nDramatičnost, srovnání, rozhodování. Perfektní pro "before/after" nebo duální nabídky.',
  'playbook', 'occipitum',
  ARRAY['web', 'split-screen', 'contrast', 'dialogue', 'dramatic', 'occipitum'],
  true
),
(
  'Micro-Interaction Personality',
  'Drobné animace na hover/click/scroll které dávají webu charakter a lidskost.',
  E'## Micro-Interactions\n\nDetail, který dělá zážitek:\n- Button hover: scale + shadow + color shift (ne jen underline)\n- Scroll: progress bar v navigaci\n- Load: skeleton → content s stagger animací\n- Error: shake + haptic feedback pattern\n- Success: confetti / check pulse\n\n### GrapeJS implementace\nCSS `@keyframes` na component level. `data-interaction="bounce|pulse|shake"` atributy.\n\n### Emocionální účinek\nPříjemnost, pozornost k detailu, lidskost. Web působí "živě".',
  'playbook', 'occipitum',
  ARRAY['web', 'micro-interaction', 'animation', 'personality', 'detail', 'occipitum'],
  true
),
(
  'Full-Bleed Photography Narrative',
  'Fotografie jako dominantní storytelling médium — text je sekundární, obraz vede.',
  E'## Photography-First Design\n\nKdyž značka má silný vizuální příběh:\n- Full-viewport obrázky (100vw × 100vh)\n- Text overlay s backdrop-filter nebo text-shadow\n- Ken Burns efekt (subtle zoom na scroll)\n- Lightbox gallery s swipe gestures\n\n### GrapeJS implementace\n`object-fit: cover` na `gjs-image`. `aspect-ratio` enforcement.\n\n### Emocionální účinek\nInspirace, touha, aspirace. Perfektní pro lifestyle brandy.',
  'playbook', 'occipitum',
  ARRAY['web', 'photography', 'fullbleed', 'visual', 'lifestyle', 'occipitum'],
  true
),
(
  'Conversational Interface Landing',
  'Landing page jako rozhovor — progresivní odhalování obsahu formou otázek a odpovědí.',
  E'## Conversational Landing\n\nMísto klasických sekcí:\n- "Co hledáte?" → dynamický obsah dle reakce\n- Typewriter efekt pro otázky\n- Branching content (mini decision tree)\n- CTA emerguje z konverzace, není vnucená\n\n### GrapeJS implementace\nCustom `data-conversation-step` component. CSS transitions mezi stavy.\n\n### Emocionální účinek\nPersonalizace, engagement, respekt k uživateli. Web se ptá místo aby mluvil.',
  'playbook', 'occipitum',
  ARRAY['web', 'conversational', 'interactive', 'personalized', 'occipitum'],
  true
),
(
  'Organic Shapes and Blob Morphing',
  'Měkké organické tvary místo ostrých obdélníků — blob SVG, wave dividers, amorfní pozadí.',
  E'## Organic Shapes\n\nLidský mozek je přitahován organickými tvary:\n- SVG blob generátory pro sekční pozadí\n- Wave separátory místo rovných linií\n- Border-radius variace (30% 70% 70% 30% / 30% 30% 70% 70%)\n- Morphing animace mezi blob stavy\n\n### GrapeJS implementace\nInline SVG s `<path>` a CSS `d` animací. Custom shape divider component.\n\n### Emocionální účinek\nPřátelskost, přirozenost, měkkost. Odstraňuje rigiditu "korporátního" designu.',
  'playbook', 'occipitum',
  ARRAY['web', 'organic', 'blob', 'shapes', 'friendly', 'occipitum'],
  true
),
(
  'Dark Mode First Luxury',
  'Tmavé pozadí jako základ luxusního dojmu — zlato/stříbro akcenty, minimální text, maximální whitespace.',
  E'## Dark Luxury\n\nKdyž značka aspiruje na premium segment:\n- Pozadí #0A0A0F až #1A1A2E\n- Akcentní barvy: zlato (#C4A24E), měď (#B87333), stříbro (#C0C0C0)\n- Ultra-thin fonty (font-weight: 200–300)\n- Generous spacing (padding: 8rem+)\n- Subtle glow efekty (box-shadow s transparentní akcentní barvou)\n\n### GrapeJS implementace\nCSS proměnné `--bg-primary: #0A0A0F`. Prefers-color-scheme ignorujeme — dark je designový záměr.\n\n### Emocionální účinek\nExkluzivita, elegance, důvěra. Premium cena se stává oprávněnou.',
  'playbook', 'occipitum',
  ARRAY['web', 'dark', 'luxury', 'premium', 'elegant', 'occipitum'],
  true
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Design Anti-patterns — explicitní blacklist
-- ---------------------------------------------------------------------------

INSERT INTO public.knowledge_items (title, summary, body_markdown, item_type, category, ai_context_tags, is_verified)
VALUES
(
  'ANTIPATTERN: Generic Hero + CTA Button',
  'Centered headline + subtitle + single CTA button na obrázkovém pozadí — nejnudnější a nejkopírovanější vzor na webu.',
  E'## Proč je to špatné\n\n90% webů začíná identicky: velký obrázek, centrovaný nadpis, podnadpis, tlačítko "Začít". Uživatel to vidí 100× týdně a okamžitě scroll-past.\n\n## Co místo toho\n- Kinetic Typography Hero\n- Split-Screen Dialogue\n- Conversational Interface Landing\n- Full-Bleed Photography s narativem',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'hero', 'generic', 'boring', 'occipitum'],
  true
),
(
  'ANTIPATTERN: Hamburger Menu Everywhere',
  'Hamburger menu na desktopu — skrývá navigaci zbytečně, snižuje engagement.',
  E'## Proč je to špatné\n\nHamburger menu bylo navrženo pro mobilní zařízení kde není místo. Na desktopu skrývá důležité odkazy za extra klik.\n\n## Co místo toho\n- Inline text navigace s hover reveal\n- Side rail navigace (sticky, visible)\n- Breadcrumb-free: kontextová navigace v obsahu\n- Command palette (Cmd+K) pro power users',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'hamburger', 'navigation', 'desktop', 'occipitum'],
  true
),
(
  'ANTIPATTERN: Cookie-Cutter Card Grid',
  'Identické karty v 3-sloupcovém gridu na opakování — produkty, features, team. Nulová vizuální hierarchie.',
  E'## Proč je to špatné\n\nKdyž všechno má stejnou vizuální váhu, nic nemá váhu. Grid identických karet je defaultní "nemám nápad" layout.\n\n## Co místo toho\n- Bento Grid s variabilními velikostmi\n- Editorial layout s featured item\n- Carousel s micro-interactions\n- Stacked cards s parallax offset',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'cards', 'grid', 'uniform', 'occipitum'],
  true
),
(
  'ANTIPATTERN: Popup Flow pro Everything',
  'Modal/popup pro objednávky, registrace, cookie consent, newsletter — uživatel je bombardován.',
  E'## Proč je to špatné\n\nKaždý popup přerušuje flow. Řetězení popupů (cookie → newsletter → akce → age gate) je UX katastrofa.\n\n## Co místo toho\n- Inline forms integrované do obsahu\n- Slide-in panels (Sheet component) místo modálů\n- Progressive disclosure — obsah se odhaluje postupně\n- Single cookie banner → preference center na dedikované stránce',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'popup', 'modal', 'intrusive', 'occipitum'],
  true
),
(
  'ANTIPATTERN: Breadcrumb Navigation Clutter',
  'Drobečková navigace viditelná na každé stránce — vizuální šum, redundantní s URL.',
  E'## Proč je to špatné\n\nBreadcrumbs jsou relikt webů s 10+ úrovněmi hloubky. Na moderních SPA s flat routing jsou zbytečné a vizuálně znečišťují header.\n\n## Co místo toho\n- Kontextová "zpět" tlačítka\n- Side navigation s active state\n- URL-based orientace (čitelné slugy)\n- Section headers s navigačním kontextem',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'breadcrumb', 'navigation', 'clutter', 'occipitum'],
  true
),
(
  'ANTIPATTERN: Stock Photo Hero',
  'Generická stock fotka usmívajících se lidí u počítačů — nula autenticity, instant distrust.',
  E'## Proč je to špatné\n\nUživatel okamžitě pozná stock fotku. "Skupina různorodých profesionálů koukajících na laptop" = ztráta důvěry.\n\n## Co místo toho\n- Autentické fotky (i nedokonalé > perfect stock)\n- Ilustrace s vlastním stylem\n- Abstract vizuály / pattern backgrounds\n- Kinetic Typography (text IS the visual)',
  'playbook', 'occipitum',
  ARRAY['web', 'antipattern', 'stock-photo', 'generic', 'inauthentic', 'occipitum'],
  true
)
ON CONFLICT DO NOTHING;
