import { createClient } from "../_shared/deps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is admin
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: isAdmin, error: isAdminError } = await supabase.rpc("has_role", {
      p_role: "admin",
      p_user_id: user.id,
    });
    const { data: isStaff, error: isStaffError } = await supabase.rpc("has_role", {
      p_role: "staff",
      p_user_id: user.id,
    });

    if (isAdminError || isStaffError || (!isAdmin && !isStaff)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all public tables
    const tables = [
      "profiles",
      "user_roles",
      "memberships",
      "studies",
      "study_registrations",
      "health_check_ins",
      "lab_results",
      "dosing_logs",
      "products",
      "orders",
      "order_items",
      "cart_items",
      "invitations",
      "notifications",
      "consents",
      "partner_profiles",
      "partner_appointments",
      "partner_availability",
      "partner_certifications",
      "data_sharing_consents",
      "member_health_documents",
      "archive_documents",
      "audit_journal",
      "token_transactions",
      "production_batches",
      "onboarding_responses",
    ];

    const dump: Record<string, unknown[]> = {};
    const errors: string[] = [];

    for (const table of tables) {
      try {
        const { data, error } = await supabase.rpc("edge_database_dump_table", {
          p_actor_user_id: user.id,
          p_table: table,
        });

        if (error) {
          errors.push(`${table}: ${error.message}`);
        } else {
          dump[table] = ((data as { rows?: unknown[] } | null)?.rows ?? []);
        }
      } catch (e) {
        errors.push(`${table}: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }

    const result = {
      exported_at: new Date().toISOString(),
      exported_by: user.email,
      tables: dump,
      row_counts: Object.fromEntries(
        Object.entries(dump).map(([k, v]) => [k, v.length])
      ),
      errors: errors.length > 0 ? errors : undefined,
    };

    const filename = `db-dump-${new Date().toISOString().split("T")[0]}.json`;

    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
