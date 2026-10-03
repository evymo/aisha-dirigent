import { serve, createClient, Stripe } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { getStripeSecretKey } from "../_shared/stripeKeys.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, "*");

  if (req.method === "OPTIONS") {
    return preflightResponse(req, "*");
  }

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const user = userData.user;
    logStep("User authenticated", { userId: user.id });

    // Get Stripe API key from DB (with env fallback)
    const stripeSecretKey = await getStripeSecretKey(supabase);
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured. Set keys in Admin > Settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Get user's active subscriptions from database
    const { data: subscriptionsResult, error: subError } = await supabase.rpc("edge_subscriptions", {
      p_action: "get_user_subscriptions",
      p_payload: {
        statuses: ["active", "pending_payment", "approved"],
        user_id: user.id,
      },
    });

    const subscriptions = ((subscriptionsResult as { rows?: Array<{
      cancel_at_period_end?: boolean | null;
      id: string;
      next_billing_date?: string | null;
      package?: {
        governance_tokens?: number | null;
        impact_tokens?: number | null;
        name?: string | null;
        period?: string | null;
        tier?: string | null;
      } | null;
      payment_type?: string | null;
      period_end?: string | null;
      period_start?: string | null;
      status: string;
      stripe_subscription_id?: string | null;
    }> } | null)?.rows ?? []);

    if (subError) {
      logStep("Error fetching subscriptions", { error: subError.message });
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check Stripe for active recurring subscriptions
    const { data: profileResult } = await supabase.rpc("edge_profiles", {
      p_action: "get_user_profile",
      p_payload: {
        user_id: user.id,
      },
    });

    const profile = (profileResult as { row?: { stripe_customer_id?: string | null } | null } | null)?.row ?? null;

    let stripeSubscriptions: Stripe.Subscription[] = [];
    if (profile?.stripe_customer_id) {
      try {
        const stripeSubList = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: "active",
          limit: 10,
        });
        stripeSubscriptions = stripeSubList.data;
        logStep("Fetched Stripe subscriptions", { count: stripeSubscriptions.length });
      } catch (stripeError) {
        logStep("Error fetching Stripe subscriptions", { error: String(stripeError) });
      }
    }

    // Sync Stripe subscription status with database
    for (const stripeSub of stripeSubscriptions) {
      const dbSubId = stripeSub.metadata?.subscription_id;
      if (dbSubId) {
        const dbSub = subscriptions?.find(s => s.id === dbSubId);
        if (dbSub && dbSub.status !== "active") {
          // Update database to reflect Stripe status
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              cancel_at_period_end: stripeSub.cancel_at_period_end,
              id: dbSubId,
              new_stripe_subscription_id: stripeSub.id,
              next_billing_date: new Date(stripeSub.current_period_end * 1000).toISOString(),
              status: "active",
            },
          });
          logStep("Synced subscription status", { subscriptionId: dbSubId });
        }
      }
    }

    // Build response
    const activeSubscription = subscriptions?.find(s => s.status === "active");
    const pendingSubscription = subscriptions?.find(s => s.status === "pending_payment" || s.status === "approved");

    const response = {
      hasActiveSubscription: !!activeSubscription,
      activeSubscription: activeSubscription ? {
        id: activeSubscription.id,
        status: activeSubscription.status,
        paymentType: activeSubscription.payment_type,
        periodStart: activeSubscription.period_start,
        periodEnd: activeSubscription.period_end,
        nextBillingDate: activeSubscription.next_billing_date,
        cancelAtPeriodEnd: activeSubscription.cancel_at_period_end,
        package: activeSubscription.package,
      } : null,
      pendingSubscription: pendingSubscription ? {
        id: pendingSubscription.id,
        status: pendingSubscription.status,
        package: pendingSubscription.package,
      } : null,
      stripeCustomerId: profile?.stripe_customer_id || null,
    };

    logStep("Returning subscription status", {
      hasActive: response.hasActiveSubscription,
      hasPending: !!response.pendingSubscription,
    });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Check subscription error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
