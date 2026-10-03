-- Function: public.create_invitation
-- Arguments: p_code text, p_study_id uuid, p_role text, p_email text, p_max_uses integer, p_expires_at timestamp with time zone, p_prefill_first_name text, p_prefill_last_name text, p_prefill_phone text, p_prefill_notes text, p_twin_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:04+01:00
--
-- ⛔ STARÁ SIGNATURA SE MUSÍ ZAHODIT, NE PŘEPSAT (2026-09-10). Postgres určuje
-- funkci JMÉNEM A TYPY ARGUMENTŮ, takže `CREATE OR REPLACE` s jedním parametrem
-- navíc starou verzi NENAHRADÍ — vyrobí PŘETÍŽENÍ. Obě by pak existovaly vedle
-- sebe, PostgREST by u volání bez `p_twin_id` hlásil nejednoznačnost a projevilo
-- by se to až v provozu, daleko od téhle změny. Proto `DROP` starého tvaru.

DROP FUNCTION IF EXISTS public.create_invitation(text, uuid, text, text, integer, timestamp with time zone, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_invitation(p_code text DEFAULT NULL::text, p_study_id uuid DEFAULT NULL::uuid, p_role text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_max_uses integer DEFAULT NULL::integer, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_prefill_first_name text DEFAULT NULL::text, p_prefill_last_name text DEFAULT NULL::text, p_prefill_phone text DEFAULT NULL::text, p_prefill_notes text DEFAULT NULL::text, p_twin_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id UUID;
    v_code TEXT;
    v_user_id UUID := auth.uid();
    v_is_admin BOOLEAN;
    v_is_partner BOOLEAN;
    v_max_uses INTEGER;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: authentication required';
    END IF;

    v_is_admin := public.is_admin_or_staff(v_user_id);
    v_is_partner := public.has_permission(v_user_id, 'view_partner_dashboard');

    -- ⭐ VAZBA SCOPE PŘIDÁVÁ, NEUBÍRÁ (majitel, 2026-09-10): „tím, že je někdo
    -- odpovědným za danou oblast, to tomu dává další scope."
    --
    -- Pověření vedoucího (`study_consultants(study_id, partner_id,
    -- status='approved')`) je tedy DALŠÍ CESTA, jak smět zvát — ne dodatečná
    -- překážka pro ty, kdo už smějí jinak. Zákon zní „oprávnění z vazeb, ne
    -- z rolí", a vazba tu roli DOPLŇUJE.
    --
    -- ⛔ NAPRVNÍ JSEM TO NAPSAL OBRÁCENĚ — jako povinnou podmínku navíc, která
    -- partnerovi bez pověření zvaní odebrala. To je přesně opačný směr, než
    -- princip říká, a projevilo by se to jako „vedoucím přestalo fungovat, co
    -- jim fungovalo". Zpřísnění, které nikdo nežádal, je vada, ne opatrnost.
    --
    -- Co se tím ZÍSKÁVÁ: schválený vedoucí oblasti smí do NÍ zvát i tehdy, když
    -- globální partnerskou schopnost nemá. Dosud nesměl — pravidlo bylo
    -- vyslovené (`can_invite_to_study`) a mělo jediného volajícího jinde,
    -- takže na hlavní cestě nikomu nic nepřidávalo.
    IF NOT v_is_admin
       AND NOT v_is_partner
       AND NOT (p_study_id IS NOT NULL AND public.can_invite_to_study(p_study_id)) THEN
        RAISE EXCEPTION 'Access denied: insufficient permissions';
    END IF;

    -- ⛔ TWIN SMÍ PŘIŘADIT JEN ADMIN/STAFF. Partner smí zvát (má
    -- `view_partner_dashboard`), ale spářit pozvánku s konkrétní osobou
    -- v evidenci je rozhodnutí o PŘÍSTUPU K DATŮM — kdo tu vazbu určí, určí,
    -- co pozvaný uvidí. Bez téhle podmínky by partner mohl vystavit pozvánku
    -- na cizího řidiče a jeho dodávky by uviděl, koho by pozval.
    IF p_twin_id IS NOT NULL AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Access denied: spárování pozvánky s twinem smí jen admin/staff';
    END IF;

    -- ⛔ POZVÁNKA NESOUCÍ IDENTITU JE JEDNORÁZOVÁ (naměřeno 2026-09-10).
    --
    -- `claim_invitation` NEKONTROLUJE adresáta — uplatní ji kdokoli, kdo zná
    -- kód. A `max_uses` se sem předává jako NULL, což PŘEBÍJE default 1
    -- ze sloupce, takže podmínka `(max_uses IS NULL OR used_count < max_uses)`
    -- znamená NEOMEZENĚ. U pozvánky s rolí to byl únosný tvar; u pozvánky
    -- s `twin_id` by to znamenalo, že se na JEDNU OSOBU naváže libovolně mnoho
    -- účtů a všechny uvidí její práci.
    --
    -- ⭐ NEZADANÁ HODNOTA SE TU DOPLŇUJE NA 1 a je to jediná hodnota, která
    -- u identity dává smysl — nikoli tichý default: vrací se ve výsledku, ať
    -- je z volání poznat, co platí. Výslovná žádost o víc se ODMÍTÁ, protože
    -- to není překlep, ale požadavek, který nelze splnit bezpečně.
    --
    -- ⛔ Neruší to potřebu indexu `uq_twin_external_refs_active_account_twin`:
    -- vazba vzniká pěti cestami a „člověk je jeden" je vlastnost DAT, ne téhle
    -- funkce. Tohle jen zavírá tu cestu, kudy by se k tomu dalo dojít omylem.
    IF p_twin_id IS NOT NULL THEN
        IF p_max_uses IS NULL THEN
            v_max_uses := 1;
        ELSIF p_max_uses <> 1 THEN
            RAISE EXCEPTION 'Pozvánka s twinem musí být jednorázová (max_uses = 1) — na jednu osobu se nesmí navázat víc účtů';
        END IF;
    END IF;

    -- ⛔ MIMO IDENTITNÍ VĚTEV PLATÍ, CO ZADAL VOLAJÍCÍ. Bez tohohle řádku by
    -- `v_max_uses` zůstalo NULL a INSERT by zahodil `p_max_uses` u VŠECH
    -- ostatních pozvánek — tichá regrese, kterou by nikdo nenahlásil, protože
    -- NULL znamená „neomezeně" a to nikoho neomezí.
    v_max_uses := COALESCE(v_max_uses, p_max_uses);

    INSERT INTO public.invitations (
        code, study_id, role, email, max_uses, expires_at,
        prefill_first_name, prefill_last_name, prefill_phone, prefill_notes,
        created_by, twin_id
    ) VALUES (
        v_code, p_study_id, p_role, p_email, v_max_uses, p_expires_at,
        p_prefill_first_name, p_prefill_last_name, p_prefill_phone, p_prefill_notes,
        v_user_id, p_twin_id
    ) RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_invitation(text, uuid, text, text, integer, timestamp with time zone, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_invitation(text, uuid, text, text, integer, timestamp with time zone, text, text, text, text, uuid) TO authenticated;
