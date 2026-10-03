-- Seed data for currency_rates table
-- Purpose: Initialize currency rates for multi-currency support
-- Note: Rates are approximate and should be updated regularly

-- CZK is base currency (rate = 1.0)
-- Other rates show how many CZK = 1 unit of foreign currency
-- e.g., 1 EUR = 25 CZK means rate_to_base = 25

INSERT INTO public.currency_rates (
  code, 
  name_key, 
  name_native, 
  symbol, 
  rate_to_base, 
  is_base, 
  is_active, 
  sort_order
) VALUES 
  ('CZK', 'currencies.CZK.name', 'Česká koruna', 'Kč', 1.0, true, true, 0),
  ('EUR', 'currencies.EUR.name', 'Euro', '€', 25.0, false, true, 1),
  ('USD', 'currencies.USD.name', 'US Dollar', '$', 23.0, false, true, 2),
  ('THB', 'currencies.THB.name', 'บาท', '฿', 0.67, false, true, 3),
  ('RUB', 'currencies.RUB.name', 'Рубль', '₽', 0.25, false, true, 4)
ON CONFLICT (code) DO UPDATE SET
  name_key = EXCLUDED.name_key,
  name_native = EXCLUDED.name_native,
  symbol = EXCLUDED.symbol,
  rate_to_base = EXCLUDED.rate_to_base,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- Seed translations for currency names
INSERT INTO public.translations (locale, namespace, key, value, created_at, updated_at) VALUES
('cs', 'common', 'currencies.CZK.name', 'Česká koruna', NOW(), NOW()),
('cs', 'common', 'currencies.EUR.name', 'Euro', NOW(), NOW()),
('cs', 'common', 'currencies.USD.name', 'Americký dolar', NOW(), NOW()),
('cs', 'common', 'currencies.THB.name', 'Thajský baht', NOW(), NOW()),
('cs', 'common', 'currencies.RUB.name', 'Ruský rubl', NOW(), NOW()),
('en', 'common', 'currencies.CZK.name', 'Czech Koruna', NOW(), NOW()),
('en', 'common', 'currencies.EUR.name', 'Euro', NOW(), NOW()),
('en', 'common', 'currencies.USD.name', 'US Dollar', NOW(), NOW()),
('en', 'common', 'currencies.THB.name', 'Thai Baht', NOW(), NOW()),
('en', 'common', 'currencies.RUB.name', 'Russian Ruble', NOW(), NOW()),
('de', 'common', 'currencies.CZK.name', 'Tschechische Krone', NOW(), NOW()),
('de', 'common', 'currencies.EUR.name', 'Euro', NOW(), NOW()),
('de', 'common', 'currencies.USD.name', 'US-Dollar', NOW(), NOW()),
('de', 'common', 'currencies.THB.name', 'Thailändischer Baht', NOW(), NOW()),
('de', 'common', 'currencies.RUB.name', 'Russischer Rubel', NOW(), NOW()),
('fr', 'common', 'currencies.CZK.name', 'Couronne tchèque', NOW(), NOW()),
('fr', 'common', 'currencies.EUR.name', 'Euro', NOW(), NOW()),
('fr', 'common', 'currencies.USD.name', 'Dollar américain', NOW(), NOW()),
('fr', 'common', 'currencies.THB.name', 'Baht thaïlandais', NOW(), NOW()),
('fr', 'common', 'currencies.RUB.name', 'Rouble russe', NOW(), NOW()),
('ru', 'common', 'currencies.CZK.name', 'Чешская крона', NOW(), NOW()),
('ru', 'common', 'currencies.EUR.name', 'Евро', NOW(), NOW()),
('ru', 'common', 'currencies.USD.name', 'Доллар США', NOW(), NOW()),
('ru', 'common', 'currencies.THB.name', 'Тайский бат', NOW(), NOW()),
('ru', 'common', 'currencies.RUB.name', 'Российский рубль', NOW(), NOW()),
('th', 'common', 'currencies.CZK.name', 'โครูนาเช็ก', NOW(), NOW()),
('th', 'common', 'currencies.EUR.name', 'ยูโร', NOW(), NOW()),
('th', 'common', 'currencies.USD.name', 'ดอลลาร์สหรัฐ', NOW(), NOW()),
('th', 'common', 'currencies.THB.name', 'บาทไทย', NOW(), NOW()),
('th', 'common', 'currencies.RUB.name', 'รูเบิลรัสเซีย', NOW(), NOW())
ON CONFLICT (locale, namespace, key) DO NOTHING;
