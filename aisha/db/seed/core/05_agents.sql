-- ============================================================================
-- STEP 5: Agent Translations (Platform AI Assistants)
--
-- NOTE: agent_configurations table was dropped by migration
--       20260411180000_drop_agent_configurations.sql (channel-centric architecture).
--       Agent config data now lives in public_chat_channels.
--       Only translations remain here.
-- ============================================================================


-- ============================================================================
-- AGENT TRANSLATIONS (namespace: agents)
-- ============================================================================
-- ============================================================================
-- AGENT TRANSLATIONS (namespace: agents)
-- ============================================================================

INSERT INTO public.translations (locale, namespace, key, value, created_at, updated_at) VALUES
-- main_agent
('en', 'agents', 'agents.main_agent.name', 'Aisha', NOW(), NOW()),
('cs', 'agents', 'agents.main_agent.name', 'Aisha', NOW(), NOW()),
('en', 'agents', 'agents.main_agent.description', 'Platform AI Assistant', NOW(), NOW()),
('cs', 'agents', 'agents.main_agent.description', 'AI asistent platformy', NOW(), NOW()),
-- classify
('en', 'agents', 'agents.classify.name', 'Classifier', NOW(), NOW()),
('cs', 'agents', 'agents.classify.name', 'Klasifikator', NOW(), NOW()),
('en', 'agents', 'agents.classify.description', 'Message routing classifier', NOW(), NOW()),
('cs', 'agents', 'agents.classify.description', 'Klasifikator smerovani zprav', NOW(), NOW()),
-- simplicity
('en', 'agents', 'agents.simplicity.name', 'Editor', NOW(), NOW()),
('cs', 'agents', 'agents.simplicity.name', 'Editor', NOW(), NOW()),
('en', 'agents', 'agents.simplicity.description', 'Language polish agent', NOW(), NOW()),
('cs', 'agents', 'agents.simplicity.description', 'Agent pro upravu jazyka', NOW(), NOW()),
-- odvozeniny (Products & Features)
('en', 'agents', 'agents.odvozeniny.name', 'Products Specialist', NOW(), NOW()),
('cs', 'agents', 'agents.odvozeniny.name', 'Specialista na produkty', NOW(), NOW()),
('en', 'agents', 'agents.odvozeniny.description', 'Platform products, features, and integrations', NOW(), NOW()),
('cs', 'agents', 'agents.odvozeniny.description', 'Produkty, funkce a integrace platformy', NOW(), NOW()),
-- praxe (Development Practice)
('en', 'agents', 'agents.praxe.name', 'Dev Practice Assistant', NOW(), NOW()),
('cs', 'agents', 'agents.praxe.name', 'Asistent vyvojove praxe', NOW(), NOW()),
('en', 'agents', 'agents.praxe.description', 'Development patterns and troubleshooting', NOW(), NOW()),
('cs', 'agents', 'agents.praxe.description', 'Vyvojove vzory a reseni problemu', NOW(), NOW()),
-- vyroba (Deployment & DevOps)
('en', 'agents', 'agents.vyroba.name', 'DevOps Specialist', NOW(), NOW()),
('cs', 'agents', 'agents.vyroba.name', 'Specialista DevOps', NOW(), NOW()),
('en', 'agents', 'agents.vyroba.description', 'Deployment, CI/CD, and infrastructure', NOW(), NOW()),
('cs', 'agents', 'agents.vyroba.description', 'Nasazeni, CI/CD a infrastruktura', NOW(), NOW()),
-- rnd
('en', 'agents', 'agents.rnd.name', 'R&D Assistant', NOW(), NOW()),
('cs', 'agents', 'agents.rnd.name', 'R&D Asistent', NOW(), NOW()),
('en', 'agents', 'agents.rnd.description', 'Feature design, experiments, and analytics', NOW(), NOW()),
('cs', 'agents', 'agents.rnd.description', 'Navrh funkci, experimenty a analytika', NOW(), NOW()),
-- studie (Documentation & Analysis)
('en', 'agents', 'agents.studie.name', 'Docs Analyst', NOW(), NOW()),
('cs', 'agents', 'agents.studie.name', 'Analytik dokumentace', NOW(), NOW()),
('en', 'agents', 'agents.studie.description', 'API docs, changelogs, and migration guides', NOW(), NOW()),
('cs', 'agents', 'agents.studie.description', 'API dokumentace, changelogy a migracni pruvodce', NOW(), NOW()),
-- revyzkum (QA & Validation)
('en', 'agents', 'agents.revyzkum.name', 'QA Assistant', NOW(), NOW()),
('cs', 'agents', 'agents.revyzkum.name', 'Asistent QA', NOW(), NOW()),
('en', 'agents', 'agents.revyzkum.description', 'Testing, validation, and quality assurance', NOW(), NOW()),
('cs', 'agents', 'agents.revyzkum.description', 'Testovani, validace a zajisteni kvality', NOW(), NOW()),
-- historie (Platform History)
('en', 'agents', 'agents.historie.name', 'Historian', NOW(), NOW()),
('cs', 'agents', 'agents.historie.name', 'Historik', NOW(), NOW()),
('en', 'agents', 'agents.historie.description', 'Platform version history and evolution', NOW(), NOW()),
('cs', 'agents', 'agents.historie.description', 'Historie verzi a vyvoj platformy', NOW(), NOW()),
-- fallback
('en', 'agents', 'agents.fallback.name', 'General Assistant', NOW(), NOW()),
('cs', 'agents', 'agents.fallback.name', 'Obecny asistent', NOW(), NOW()),
('en', 'agents', 'agents.fallback.description', 'Fallback for out-of-scope queries', NOW(), NOW()),
('cs', 'agents', 'agents.fallback.description', 'Zalozni agent pro dotazy mimo rozsah', NOW(), NOW())
ON CONFLICT (locale, namespace, key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- ============================================================================
-- AGENT TRANSLATIONS — de, fr, ru, th
-- Ensures all 6 supported locales have agent name/description keys.
-- ============================================================================

INSERT INTO public.translations (locale, namespace, key, value, created_at, updated_at) VALUES
-- main_agent
('de', 'agents', 'agents.main_agent.name', 'Aisha', NOW(), NOW()),
('fr', 'agents', 'agents.main_agent.name', 'Aisha', NOW(), NOW()),
('ru', 'agents', 'agents.main_agent.name', 'Aisha', NOW(), NOW()),
('th', 'agents', 'agents.main_agent.name', 'Aisha', NOW(), NOW()),
('de', 'agents', 'agents.main_agent.description', 'KI-Assistent der Plattform', NOW(), NOW()),
('fr', 'agents', 'agents.main_agent.description', 'Assistant IA de la plateforme', NOW(), NOW()),
('ru', 'agents', 'agents.main_agent.description', 'ИИ-ассистент платформы', NOW(), NOW()),
('th', 'agents', 'agents.main_agent.description', 'ผู้ช่วย AI ของแพลตฟอร์ม', NOW(), NOW()),
-- classify
('de', 'agents', 'agents.classify.name', 'Klassifikator', NOW(), NOW()),
('fr', 'agents', 'agents.classify.name', 'Classificateur', NOW(), NOW()),
('ru', 'agents', 'agents.classify.name', 'Классификатор', NOW(), NOW()),
('th', 'agents', 'agents.classify.name', 'ตัวจำแนก', NOW(), NOW()),
('de', 'agents', 'agents.classify.description', 'Nachrichtenrouting-Klassifikator', NOW(), NOW()),
('fr', 'agents', 'agents.classify.description', 'Classificateur de routage des messages', NOW(), NOW()),
('ru', 'agents', 'agents.classify.description', 'Классификатор маршрутизации сообщений', NOW(), NOW()),
('th', 'agents', 'agents.classify.description', 'ตัวจำแนกการกำหนดเส้นทางข้อความ', NOW(), NOW()),
-- simplicity
('de', 'agents', 'agents.simplicity.name', 'Editor', NOW(), NOW()),
('fr', 'agents', 'agents.simplicity.name', 'Editeur', NOW(), NOW()),
('ru', 'agents', 'agents.simplicity.name', 'Редактор', NOW(), NOW()),
('th', 'agents', 'agents.simplicity.name', 'บรรณาธิการ', NOW(), NOW()),
('de', 'agents', 'agents.simplicity.description', 'Sprachoptimierungsagent', NOW(), NOW()),
('fr', 'agents', 'agents.simplicity.description', 'Agent de polissage linguistique', NOW(), NOW()),
('ru', 'agents', 'agents.simplicity.description', 'Агент улучшения текста', NOW(), NOW()),
('th', 'agents', 'agents.simplicity.description', 'เอเจนต์ปรับปรุงภาษา', NOW(), NOW()),
-- odvozeniny (Products & Features)
('de', 'agents', 'agents.odvozeniny.name', 'Produktspezialist', NOW(), NOW()),
('fr', 'agents', 'agents.odvozeniny.name', 'Specialiste produits', NOW(), NOW()),
('ru', 'agents', 'agents.odvozeniny.name', 'Специалист по продуктам', NOW(), NOW()),
('th', 'agents', 'agents.odvozeniny.name', 'ผู้เชี่ยวชาญด้านผลิตภัณฑ์', NOW(), NOW()),
('de', 'agents', 'agents.odvozeniny.description', 'Plattformprodukte, Funktionen und Integrationen', NOW(), NOW()),
('fr', 'agents', 'agents.odvozeniny.description', 'Produits, fonctionnalites et integrations', NOW(), NOW()),
('ru', 'agents', 'agents.odvozeniny.description', 'Продукты, функции и интеграции платформы', NOW(), NOW()),
('th', 'agents', 'agents.odvozeniny.description', 'ผลิตภัณฑ์ ฟีเจอร์ และการผสานรวม', NOW(), NOW()),
-- praxe (Development Practice)
('de', 'agents', 'agents.praxe.name', 'Entwicklungspraxis-Assistent', NOW(), NOW()),
('fr', 'agents', 'agents.praxe.name', 'Assistant pratique de developpement', NOW(), NOW()),
('ru', 'agents', 'agents.praxe.name', 'Ассистент практики разработки', NOW(), NOW()),
('th', 'agents', 'agents.praxe.name', 'ผู้ช่วยด้านการปฏิบัติงานพัฒนา', NOW(), NOW()),
('de', 'agents', 'agents.praxe.description', 'Entwicklungsmuster und Fehlerbehebung', NOW(), NOW()),
('fr', 'agents', 'agents.praxe.description', 'Modeles de developpement et resolution de problemes', NOW(), NOW()),
('ru', 'agents', 'agents.praxe.description', 'Шаблоны разработки и устранение неполадок', NOW(), NOW()),
('th', 'agents', 'agents.praxe.description', 'รูปแบบการพัฒนาและการแก้ไขปัญหา', NOW(), NOW()),
-- vyroba (Deployment & DevOps)
('de', 'agents', 'agents.vyroba.name', 'DevOps-Spezialist', NOW(), NOW()),
('fr', 'agents', 'agents.vyroba.name', 'Specialiste DevOps', NOW(), NOW()),
('ru', 'agents', 'agents.vyroba.name', 'Специалист DevOps', NOW(), NOW()),
('th', 'agents', 'agents.vyroba.name', 'ผู้เชี่ยวชาญ DevOps', NOW(), NOW()),
('de', 'agents', 'agents.vyroba.description', 'Deployment, CI/CD und Infrastruktur', NOW(), NOW()),
('fr', 'agents', 'agents.vyroba.description', 'Deploiement, CI/CD et infrastructure', NOW(), NOW()),
('ru', 'agents', 'agents.vyroba.description', 'Развёртывание, CI/CD и инфраструктура', NOW(), NOW()),
('th', 'agents', 'agents.vyroba.description', 'การปรับใช้ CI/CD และโครงสร้างพื้นฐาน', NOW(), NOW()),
-- rnd
('de', 'agents', 'agents.rnd.name', 'F&E-Assistent', NOW(), NOW()),
('fr', 'agents', 'agents.rnd.name', 'Assistant R&D', NOW(), NOW()),
('ru', 'agents', 'agents.rnd.name', 'Ассистент НИОКР', NOW(), NOW()),
('th', 'agents', 'agents.rnd.name', 'ผู้ช่วย R&D', NOW(), NOW()),
('de', 'agents', 'agents.rnd.description', 'Funktionsdesign, Experimente und Analytik', NOW(), NOW()),
('fr', 'agents', 'agents.rnd.description', 'Conception de fonctionnalites, experiences et analytique', NOW(), NOW()),
('ru', 'agents', 'agents.rnd.description', 'Проектирование функций, эксперименты и аналитика', NOW(), NOW()),
('th', 'agents', 'agents.rnd.description', 'การออกแบบฟีเจอร์ การทดลอง และการวิเคราะห์', NOW(), NOW()),
-- studie (Documentation & Analysis)
('de', 'agents', 'agents.studie.name', 'Dokumentationsanalyst', NOW(), NOW()),
('fr', 'agents', 'agents.studie.name', 'Analyste documentation', NOW(), NOW()),
('ru', 'agents', 'agents.studie.name', 'Аналитик документации', NOW(), NOW()),
('th', 'agents', 'agents.studie.name', 'นักวิเคราะห์เอกสาร', NOW(), NOW()),
('de', 'agents', 'agents.studie.description', 'API-Dokumentation, Changelogs und Migrationsleitfaden', NOW(), NOW()),
('fr', 'agents', 'agents.studie.description', 'Documentation API, changelogs et guides de migration', NOW(), NOW()),
('ru', 'agents', 'agents.studie.description', 'Документация API, журналы изменений и руководства по миграции', NOW(), NOW()),
('th', 'agents', 'agents.studie.description', 'เอกสาร API บันทึกการเปลี่ยนแปลง และคู่มือการโยกย้าย', NOW(), NOW()),
-- revyzkum (QA & Validation)
('de', 'agents', 'agents.revyzkum.name', 'QA-Assistent', NOW(), NOW()),
('fr', 'agents', 'agents.revyzkum.name', 'Assistant QA', NOW(), NOW()),
('ru', 'agents', 'agents.revyzkum.name', 'Ассистент QA', NOW(), NOW()),
('th', 'agents', 'agents.revyzkum.name', 'ผู้ช่วย QA', NOW(), NOW()),
('de', 'agents', 'agents.revyzkum.description', 'Testen, Validierung und Qualitaetssicherung', NOW(), NOW()),
('fr', 'agents', 'agents.revyzkum.description', 'Tests, validation et assurance qualite', NOW(), NOW()),
('ru', 'agents', 'agents.revyzkum.description', 'Тестирование, валидация и обеспечение качества', NOW(), NOW()),
('th', 'agents', 'agents.revyzkum.description', 'การทดสอบ การตรวจสอบ และการประกันคุณภาพ', NOW(), NOW()),
-- historie (Platform History)
('de', 'agents', 'agents.historie.name', 'Historiker', NOW(), NOW()),
('fr', 'agents', 'agents.historie.name', 'Historien', NOW(), NOW()),
('ru', 'agents', 'agents.historie.name', 'Историк', NOW(), NOW()),
('th', 'agents', 'agents.historie.name', 'นักประวัติศาสตร์', NOW(), NOW()),
('de', 'agents', 'agents.historie.description', 'Versionsgeschichte und Plattformentwicklung', NOW(), NOW()),
('fr', 'agents', 'agents.historie.description', 'Historique des versions et evolution de la plateforme', NOW(), NOW()),
('ru', 'agents', 'agents.historie.description', 'История версий и эволюция платформы', NOW(), NOW()),
('th', 'agents', 'agents.historie.description', 'ประวัติเวอร์ชันและวิวัฒนาการของแพลตฟอร์ม', NOW(), NOW()),
-- fallback
('de', 'agents', 'agents.fallback.name', 'Allgemeiner Assistent', NOW(), NOW()),
('fr', 'agents', 'agents.fallback.name', 'Assistant general', NOW(), NOW()),
('ru', 'agents', 'agents.fallback.name', 'Общий ассистент', NOW(), NOW()),
('th', 'agents', 'agents.fallback.name', 'ผู้ช่วยทั่วไป', NOW(), NOW()),
('de', 'agents', 'agents.fallback.description', 'Ruckfallagent fur themenubergreifende Anfragen', NOW(), NOW()),
('fr', 'agents', 'agents.fallback.description', 'Agent de secours pour les requetes hors perimetre', NOW(), NOW()),
('ru', 'agents', 'agents.fallback.description', 'Резервный агент для запросов вне области', NOW(), NOW()),
('th', 'agents', 'agents.fallback.description', 'เอเจนต์สำรองสำหรับคำถามนอกขอบเขต', NOW(), NOW())
ON CONFLICT (locale, namespace, key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();
