import { serve, createClient, Stripe } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS, cleanupRateLimitStore } from "../_shared/rateLimiter.ts";
import { getStripeSecretKey } from "../_shared/stripeKeys.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SubscriptionCheckoutRequest {
  packageId: string;
  paymentType: "one_time" | "recurring";
  subscriptionId?: string;
  currency?: string;
  locale?: string;
  successUrl?: string;
  cancelUrl?: string;
}

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SUBSCRIPTION-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, "*");

  if (req.method === "OPTIONS") {
    return preflightResponse(req, "*");
  }

  cleanupRateLimitStore();

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
      logStep("Auth error", { error: userError?.message });
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const user = userData.user;
    logStep("User authenticated", { userId: user.id });

    // Rate limiting
    const rateLimit = checkRateLimit(user.id, RATE_LIMITS.checkout);
    if (!rateLimit.allowed) {
      console.warn(`Rate limit exceeded for user ${user.id}`);
      return rateLimitResponse(rateLimit, corsHeaders);
    }

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

    const { packageId, paymentType, subscriptionId, currency, locale, successUrl, cancelUrl }: SubscriptionCheckoutRequest = await req.json();
    logStep("Request parsed", { packageId, paymentType, subscriptionId, currency, locale });

    if (!packageId || !paymentType) {
      return new Response(
        JSON.stringify({ error: "Package ID and payment type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch subscription package
    const { data: packageResult, error: pkgError } = await supabase.rpc("edge_subscriptions", {
      p_action: "get_package_by_id",
      p_payload: {
        package_id: packageId,
      },
    });

    const pkg = (packageResult as { row?: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      tier: string;
      period: string;
      price: number;
      currency: string | null;
      price_czk: number | null;
      price_usd: number | null;
      is_recurring: boolean | null;
      stripe_product_id: string | null;
      stripe_price_id: string | null;
      stripe_price_id_one_time: string | null;
      stripe_price_id_recurring: string | null;
      min_billing_months: number | null;
      billing_interval_months: number | null;
      allow_one_time_payment: boolean | null;
      allow_recurring_payment: boolean | null;
      governance_tokens: number | null;
      impact_tokens: number | null;
    } | null } | null)?.row ?? null;

    if (pkgError || !pkg) {
      logStep("Package not found", { packageId, error: pkgError?.message });
      return new Response(
        JSON.stringify({ error: "Subscription package not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Package found", { name: pkg.name, tier: pkg.tier });

    let checkoutPaymentType: "one_time" | "recurring" = paymentType;
    let existingSubscription: { id: string; package_id: string; payment_type: "one_time" | "recurring"; status: string } | null = null;

    if (subscriptionId) {
      const { data: existingResult, error: existingError } = await supabase.rpc("edge_subscriptions", {
        p_action: "get_user_subscriptions",
        p_payload: {
          user_id: user.id,
          statuses: ["approved", "pending_payment"],
        },
      });

      type EdgeSubscriptionRow = {
        id: string;
        package_id: string;
        payment_type: "one_time" | "recurring";
        status: string;
      };

      const subscriptions = ((existingResult as { rows?: EdgeSubscriptionRow[] } | null)?.rows ?? []);
      existingSubscription = subscriptions.find((sub) => sub.id === subscriptionId) ?? null;

      if (existingError || !existingSubscription) {
        logStep("Subscription not found for checkout", { subscriptionId, error: existingError?.message });
        return new Response(
          JSON.stringify({ error: "Approved subscription request not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (existingSubscription.package_id !== pkg.id) {
        return new Response(
          JSON.stringify({ error: "Subscription package mismatch" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      checkoutPaymentType = existingSubscription.payment_type;
      logStep("Using existing subscription request", {
        subscriptionId: existingSubscription.id,
        status: existingSubscription.status,
        paymentType: checkoutPaymentType,
      });
    }

    // Validate payment type is allowed
    if (checkoutPaymentType === "one_time" && !pkg.allow_one_time_payment) {
      return new Response(
        JSON.stringify({ error: "One-time payment not allowed for this package" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (checkoutPaymentType === "recurring" && !pkg.allow_recurring_payment) {
      return new Response(
        JSON.stringify({ error: "Recurring payment not allowed for this package" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get or create Stripe customer
    let stripeCustomerId: string;

    const { data: profileResult } = await supabase.rpc("edge_profiles", {
      p_action: "get_user_profile",
      p_payload: {
        user_id: user.id,
      },
    });

    const profile = (profileResult as { row?: {
      stripe_customer_id?: string | null;
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    } | null } | null)?.row ?? null;

    if (profile?.stripe_customer_id) {
      stripeCustomerId = profile.stripe_customer_id;
      logStep("Existing Stripe customer", { customerId: stripeCustomerId });
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() : undefined,
        metadata: { supabase_user_id: user.id },
      });
      stripeCustomerId = customer.id;
      logStep("Created Stripe customer", { customerId: stripeCustomerId });

      await supabase.rpc("edge_profiles", {
        p_action: "set_stripe_customer",
        p_payload: {
          stripe_customer_id: stripeCustomerId,
          user_id: user.id,
        },
      });
    }

    const packageCurrency = (pkg.currency || "CZK").toUpperCase();
    const targetCurrency = (currency || packageCurrency).toUpperCase();

    // Determine the Stripe price to use (persist only when using package currency)
    let stripePriceId = targetCurrency === packageCurrency
      ? (checkoutPaymentType === "recurring"
        ? (pkg.stripe_price_id_recurring || pkg.stripe_price_id)
        : (pkg.stripe_price_id_one_time || pkg.stripe_price_id))
      : null;

    // If no Stripe price exists, create one dynamically
    if (!stripePriceId) {
      logStep("Creating dynamic Stripe price");

      // Create or get product
      let stripeProductId = pkg.stripe_product_id;
      if (!stripeProductId) {
        const product = await stripe.products.create({
          name: pkg.name,
          description: pkg.description || `${pkg.tier} subscription - ${pkg.period}`,
          metadata: {
            supabase_package_id: pkg.id,
            tier: pkg.tier,
            period: pkg.period,
          },
        });
        stripeProductId = product.id;
        
        await supabase.rpc("edge_subscriptions", {
          p_action: "update_package_stripe",
          p_payload: {
            package_id: pkg.id,
            stripe_product_id: stripeProductId,
          },
        });
        
        logStep("Created Stripe product", { productId: stripeProductId });
      }

      // Calculate amount based on payment type (convert if needed)
      let amount = pkg.price;
      if (targetCurrency !== packageCurrency) {
        const { data: converted, error: convertError } = await supabase.rpc("convert_currency_amount", {
          p_amount: pkg.price,
          p_from_currency: packageCurrency,
          p_to_currency: targetCurrency,
        });
        if (!convertError && typeof converted === "number") {
          amount = converted;
        }
      }

      if (checkoutPaymentType === "recurring") {
        // For recurring, calculate per billing interval
        const billingIntervalMonths = pkg.billing_interval_months || 1;
        const periodMonths = pkg.period === "monthly" ? 1 : pkg.period === "quarterly" ? 3 : 12;
        const recurringAmount = Math.round((amount / periodMonths) * billingIntervalMonths * 100);

        const price = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: recurringAmount,
          currency: targetCurrency.toLowerCase(),
          recurring: { interval: "month", interval_count: billingIntervalMonths },
          metadata: { supabase_package_id: pkg.id, payment_type: "recurring", currency: targetCurrency },
        });
        stripePriceId = price.id;

        if (targetCurrency === packageCurrency) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_package_stripe",
            p_payload: {
              package_id: pkg.id,
              stripe_price_id_recurring: stripePriceId,
            },
          });
        }
      } else {
        // One-time payment for full period
        const price = await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(amount * 100),
          currency: targetCurrency.toLowerCase(),
          metadata: { supabase_package_id: pkg.id, payment_type: "one_time", currency: targetCurrency },
        });
        stripePriceId = price.id;

        if (targetCurrency === packageCurrency) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_package_stripe",
            p_payload: {
              package_id: pkg.id,
              stripe_price_id_one_time: stripePriceId,
            },
          });
        }
      }

      logStep("Created Stripe price", { priceId: stripePriceId, paymentType: checkoutPaymentType });
    }

    // Calculate subscription period
    const now = new Date();
    const periodEnd = new Date(now);
    switch (pkg.period) {
      case "monthly":
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        break;
      case "quarterly":
        periodEnd.setMonth(periodEnd.getMonth() + 3);
        break;
      case "annual":
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        break;
    }

    // Create pending subscription record
    // Calculate amount for records (full period in target currency)
    let recordAmount = pkg.price;
    if (targetCurrency !== packageCurrency) {
      const { data: convertedAmount, error: convertError } = await supabase.rpc("convert_currency_amount", {
        p_amount: pkg.price,
        p_from_currency: packageCurrency,
        p_to_currency: targetCurrency,
      });
      if (!convertError && typeof convertedAmount === "number") {
        recordAmount = convertedAmount;
      }
    }

    let subscription = existingSubscription ? { id: existingSubscription.id } : null;

    if (existingSubscription) {
      if (existingSubscription.status === "approved") {
        const { error: updateError } = await supabase.rpc("edge_subscriptions", {
          p_action: "update_subscription",
          p_payload: {
            id: existingSubscription.id,
            status: "pending_payment",
          },
        });

        if (updateError) {
          logStep("Failed to update approved subscription to pending_payment", {
            error: updateError.message,
            subscriptionId: existingSubscription.id,
          });
          return new Response(
            JSON.stringify({ error: "Failed to prepare subscription for payment" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      logStep("Reusing existing subscription", { subscriptionId: existingSubscription.id });
    } else {
      const { data: subscriptionResult, error: subError } = await supabase.rpc("edge_subscriptions", {
        p_action: "create_member_subscription",
        p_payload: {
          amount_paid: recordAmount,
          billing_interval_months: pkg.billing_interval_months || 1,
          currency: targetCurrency,
          package_id: pkg.id,
          payment_type: checkoutPaymentType,
          period_end: periodEnd.toISOString(),
          period_start: now.toISOString(),
          status: "pending_payment",
          user_id: user.id,
        },
      });

      subscription = (subscriptionResult as { id?: string } | null)?.id
        ? { id: (subscriptionResult as { id: string }).id }
        : null;

      if (subError || !subscription) {
        logStep("Failed to create subscription record", { error: subError?.message });
        return new Response(
          JSON.stringify({ error: "Failed to create subscription record" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      logStep("Created pending subscription", { subscriptionId: subscription.id });
    }

    if (!subscription) {
      return new Response(
        JSON.stringify({ error: "Subscription checkout preparation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const origin = req.headers.get("origin") || "https://web.platform.com";

    // Create Stripe Checkout Session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      mode: checkoutPaymentType === "recurring" ? "subscription" : "payment",
      success_url: successUrl || `${origin}/member/subscription?success=true&subscription_id=${subscription.id}`,
      cancel_url: cancelUrl || `${origin}/subscription?cancelled=true`,
      metadata: {
        subscription_id: subscription.id,
        package_id: pkg.id,
        user_id: user.id,
        payment_type: checkoutPaymentType,
        currency: targetCurrency,
      },
      locale: (locale || "cs") as Stripe.Checkout.SessionCreateParams.Locale,
      payment_method_types: ["card"],
    };

    // For recurring, set subscription data
    if (checkoutPaymentType === "recurring") {
      sessionParams.subscription_data = {
        metadata: {
          subscription_id: subscription.id,
          package_id: pkg.id,
          user_id: user.id,
          currency: targetCurrency,
        },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    logStep("Created Stripe checkout session", { sessionId: session.id, url: session.url });

    // Record payment session
    await supabase.rpc("edge_payment_sessions", {
      p_action: "insert",
      p_payload: {
        amount: recordAmount,
        amount_czk: targetCurrency === "CZK" ? Math.round(recordAmount) : null,
        currency: targetCurrency,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        metadata: {
          currency: targetCurrency,
          package_id: pkg.id,
          package_name: pkg.name,
          payment_type: checkoutPaymentType,
        },
        reference_id: subscription.id,
        reference_type: "subscription",
        session_type: "subscription_checkout",
        status: "pending",
        stripe_session_id: session.id,
        user_id: user.id,
      },
    });

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        subscriptionId: subscription.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Subscription checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
