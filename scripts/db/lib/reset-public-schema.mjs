/**
 * reset-public-schema.mjs — SQL, kterým migrate.mjs zahodí a znovu založí schéma `public`.
 *
 * ⛔ NENÍ TO VZÁCNÁ NOUZOVÁ CESTA. Vstupní skript migrace si PŘED `db:migrate`
 * založí v `public` svou značku běhu; na čisté databázi tak migrate.mjs vidí
 * „tabulky bez baseline“ a schéma resetuje. Reset proto proběhne při KAŽDÉM
 * studeném startu — práva, která tady schéma dostane, má každá instance.
 *
 * ⛔ ZMĚŘENO 2026-10-03 na živé instanci: ACL schématu bylo
 * `{vlastník=UC, postgres=UC, =UC}`. Reset dával právo VYTVÁŘET všem rolím
 * (PUBLIC) a `DROP … CASCADE` zároveň smazal granty z init skriptu rolí — i ten
 * pro roli, která v `public` své tabulky opravdu zakládá. Široký grant tak
 * zakrýval, že úzké chybí.
 *
 * PROČ ZÁLEŽÍ NA `CREATE`: funkce SECURITY DEFINER v `public` patří
 * superuživateli a volají další funkce a operátory bez kvalifikace. Kdo smí ve
 * schématu vytvářet, podstrčí přetížení s přesnějším typem argumentu a jeho kód
 * poběží právy vlastníka.
 *
 * Po resetu má schéma tatáž práva, jaká mu dává init skript rolí
 * (infra/postgres/000_init_roles_schemas.sql) — shodu hlídá brána
 * `postgres-grants`. PUBLIC dostává jen USAGE, jako v čistém PostgreSQL 15+.
 * Výchozí práva k tabulkám (ALTER DEFAULT PRIVILEGES) se tu NEVRACEJÍ: reset je
 * nevracel nikdy a rozšířil by se tím přístup proti dnešnímu stavu instancí.
 */
export const RESET_PUBLIC_SCHEMA_SQL = `DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
DO $reset$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nocodb_app') THEN
    GRANT USAGE, CREATE ON SCHEMA public TO nocodb_app;
  END IF;
END
$reset$;`;
