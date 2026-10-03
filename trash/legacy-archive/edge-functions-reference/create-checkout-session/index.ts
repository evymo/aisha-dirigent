import { serve, createClient, Stripe } from "../_shared/deps.ts";
import { buildCorsHeaders, preflightResponse } from "../_shared/cors.ts";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS, cleanupRateLimitStore } from "../_shared/rateLimiter.ts";
import { getStripeSecretKey } from "../_shared/stripeKeys.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CheckoutRequest {
  orderId: string;
  locale?: string;
  successUrl?: string;
  cancelUrl?: string;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, "*");
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return preflightResponse(req, "*");
  }

  // Periodic cleanup of rate limit store
  cleanupRateLimitStore();

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's JWT
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Service-role client for reading secrets from Vault via edge_app_secrets.
    // The main `supabase` client overrides Authorization with the user JWT,
    // which makes PostgREST see `authenticated` role — but edge_app_secrets
    // is only granted to `service_role`. This client keeps the service-role
    // identity intact.
    const serviceRoleClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: 10 checkout sessions per hour per user
    const rateLimit = checkRateLimit(user.id, RATE_LIMITS.checkout);
    if (!rateLimit.allowed) {
      console.warn(`Rate limit exceeded for user ${user.id} on checkout`);
      return rateLimitResponse(rateLimit, corsHeaders);
    }

    // Get Stripe API key from DB (with env fallback)
    const stripeSecretKey = await getStripeSecretKey(serviceRoleClient);
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured. Set keys in Admin > Settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { orderId, locale, successUrl, cancelUrl }: CheckoutRequest = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "Order ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the order with items
    const { data: orderResult, error: orderError } = await supabase.rpc("edge_orders", {
      p_action: "get_checkout_context",
      p_payload: {
        order_id: orderId,
        user_id: user.id,
      },
    });

    const order = (orderResult as { row?: {
      id: string;
      user_id: string;
      total: number;
      shipping: number | null;
      currency: string | null;
      status: string;
      shipping_address: Record<string, unknown> | null;
      order_items: Array<{
        id: string;
        product_id: string;
        quantity: number;
        price_at_purchase: number;
        product: Array<{
          name: string;
          description: string | null;
        }> | null;
      }>;
    } | null } | null)?.row ?? null;

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (order.status !== "pending") {
      return new Response(
        JSON.stringify({ error: "Order is not in pending status" }),
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

    const profile = (profileResult as { row?: { stripe_customer_id?: string | null; email?: string | null } | null } | null)?.row ?? null;

    if (profile?.stripe_customer_id) {
      stripeCustomerId = profile.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      stripeCustomerId = customer.id;

      // Save Stripe customer ID to profile
      await supabase.rpc("edge_profiles", {
        p_action: "set_stripe_customer",
        p_payload: {
          stripe_customer_id: stripeCustomerId,
          user_id: user.id,
        },
      });
    }

    // Type for order items from DB query
    // Note: Supabase returns related data as array due to the join
    interface OrderItemFromDb {
      id: string;
      product_id: string;
      quantity: number;
      price_at_purchase: number;
      product: Array<{
        name: string;
        description: string | null;
      }> | null;
    }

    // Create line items for Stripe
    const orderCurrency = (order.currency || "CZK").toLowerCase();
    const lineItems = (order.order_items as OrderItemFromDb[]).map((item) => ({
      price_data: {
        currency: orderCurrency,
        product_data: {
          name: item.product?.[0]?.name || "Product",
          description: item.product?.[0]?.description?.substring(0, 500) || undefined,
        },
        unit_amount: Math.round(item.price_at_purchase * 100), // Convert to cents
      },
      quantity: item.quantity,
    }));

    if (order.shipping && Number(order.shipping) > 0) {
      lineItems.push({
        price_data: {
          currency: orderCurrency,
          product_data: {
            name: "Shipping",
            description: undefined,
          },
          unit_amount: Math.round(Number(order.shipping) * 100),
        },
        quantity: 1,
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: successUrl || `${req.headers.get("origin")}/member/orders?success=true&order_id=${orderId}`,
      cancel_url: cancelUrl || `${req.headers.get("origin")}/checkout?cancelled=true`,
      metadata: {
        order_id: orderId,
        user_id: user.id,
        currency: order.currency || "CZK",
      },
      shipping_address_collection: {
        allowed_countries: ["CZ", "SK", "DE", "AT", "PL"],
      },
      billing_address_collection: "required",
      locale: (locale || "cs") as Stripe.Checkout.SessionCreateParams.Locale,
    });

    // Update order with Stripe session ID
    await supabase.rpc("edge_orders", {
      p_action: "update_order",
      p_payload: {
        order_id: orderId,
        status: "awaiting_payment",
        stripe_payment_intent_id: session.id,
        stripe_session_id: session.id,
      },
    });

    await supabase.rpc("edge_payment_sessions", {
      p_action: "insert",
      p_payload: {
        amount: order.total,
        amount_czk: (order.currency || "").toUpperCase() === "CZK" ? Math.round(Number(order.total)) : null,
        currency: order.currency || "CZK",
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        metadata: {
          currency: order.currency || "CZK",
          order_id: orderId,
        },
        reference_id: orderId,
        reference_type: "order",
        session_type: "order_checkout",
        status: "pending",
        stripe_session_id: session.id,
        user_id: user.id,
      },
    });

    return new Response(
      JSON.stringify({ 
        sessionId: session.id,
        url: session.url 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error("Stripe checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...buildCorsHeaders(req, "*"), "Content-Type": "application/json" } }
    );
  }
});
