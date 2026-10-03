import { serve, createClient, Stripe } from "../_shared/deps.ts";
import { getStripeSecretKey } from "../_shared/stripeKeys.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  try {
    // Create service client for DB access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get Stripe key from DB (with env fallback)
    const stripeSecretKey = await getStripeSecretKey(supabase);
    if (!stripeSecretKey) {
      console.error("[STRIPE-WEBHOOK] Stripe not configured");
      return new Response("Stripe not configured", { status: 500 });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
    });

    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

    logStep("Event received", { type: event.type });

    switch (event.type) {
      // ========== ORDER EVENTS ==========
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        const subscriptionId = session.metadata?.subscription_id;
        const userId = session.metadata?.user_id;
        const paymentType = session.metadata?.payment_type;

        logStep("Checkout completed", { orderId, subscriptionId, paymentType });

        // Update payment session
        await supabase.rpc("edge_payment_sessions", {
          p_action: "update_status",
          p_payload: {
            completed_at: new Date().toISOString(),
            status: "completed",
            stripe_session_id: session.id,
          },
        });

        if (orderId) {
          // Product order payment
          await supabase.rpc("edge_orders", {
            p_action: "update_order",
            p_payload: {
              order_id: orderId,
              status: "paid",
              stripe_payment_intent_id: session.payment_intent as string,
            },
          });

          await supabase.rpc("record_audit_log", {
            p_action: "order.payment_completed",
            p_details: {
              stripe_session_id: session.id,
              payment_intent: session.payment_intent,
              amount_total: session.amount_total,
              currency: session.currency,
            },
            p_resource_id: orderId,
            p_resource_type: "order",
            p_user_id: userId
          });
        }

        if (subscriptionId) {
          // Subscription payment (one-time)
          if (paymentType === "one_time") {
            await supabase.rpc("edge_subscriptions", {
              p_action: "update_subscription",
              p_payload: {
                id: subscriptionId,
                status: "active",
                stripe_payment_intent_id: session.payment_intent as string,
              },
            });

            logStep("One-time subscription activated", { subscriptionId });
          }
          // For recurring, the subscription is handled by invoice.paid event
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id;
        const subscriptionId = session.metadata?.subscription_id;

        logStep("Checkout expired", { orderId, subscriptionId });

        // Update payment session
        await supabase.rpc("edge_payment_sessions", {
          p_action: "update_status",
          p_payload: {
            status: "expired",
            stripe_session_id: session.id,
          },
        });

        if (orderId) {
          await supabase.rpc("edge_orders", {
            p_action: "update_order",
            p_payload: {
              order_id: orderId,
              status: "payment_expired",
            },
          });
        }

        if (subscriptionId) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              id: subscriptionId,
              status: "payment_expired",
            },
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata?.order_id;
        const subscriptionId = paymentIntent.metadata?.subscription_id;

        logStep("Payment failed", { orderId, subscriptionId });

        if (orderId) {
          await supabase.rpc("edge_orders", {
            p_action: "update_order",
            p_payload: {
              order_id: orderId,
              status: "payment_failed",
            },
          });
        }

        if (subscriptionId) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              id: subscriptionId,
              status: "payment_failed",
            },
          });
        }
        break;
      }

      // ========== SUBSCRIPTION EVENTS ==========
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.metadata?.subscription_id;
        const userId = subscription.metadata?.user_id;

        logStep("Stripe subscription created", { 
          stripeSubId: subscription.id, 
          subscriptionId,
          status: subscription.status 
        });

        if (subscriptionId) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              id: subscriptionId,
              new_stripe_subscription_id: subscription.id,
              next_billing_date: new Date(subscription.current_period_end * 1000).toISOString(),
              status: subscription.status === "active" ? "active" : "pending_payment",
            },
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.metadata?.subscription_id;

        logStep("Subscription updated", { 
          stripeSubId: subscription.id,
          subscriptionId,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end
        });

        if (subscriptionId) {
          let dbStatus = "active";
          if (subscription.status === "canceled") dbStatus = "cancelled";
          else if (subscription.status === "past_due") dbStatus = "past_due";
          else if (subscription.status === "unpaid") dbStatus = "unpaid";

          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              cancel_at_period_end: subscription.cancel_at_period_end,
              id: subscriptionId,
              next_billing_date: new Date(subscription.current_period_end * 1000).toISOString(),
              status: dbStatus,
            },
          });
        } else {
          // Try to find by stripe_subscription_id
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              cancel_at_period_end: subscription.cancel_at_period_end,
              next_billing_date: new Date(subscription.current_period_end * 1000).toISOString(),
              status: subscription.status === "active" ? "active" : subscription.status,
              stripe_subscription_id: subscription.id,
            },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.metadata?.subscription_id;

        logStep("Subscription deleted/cancelled", { 
          stripeSubId: subscription.id, 
          subscriptionId 
        });

        if (subscriptionId) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              id: subscriptionId,
              status: "cancelled",
            },
          });
        } else {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              status: "cancelled",
              stripe_subscription_id: subscription.id,
            },
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionStripeId = invoice.subscription as string | null;

        logStep("Invoice paid", { 
          invoiceId: invoice.id, 
          subscriptionId: subscriptionStripeId,
          amountPaid: invoice.amount_paid 
        });

        if (subscriptionStripeId) {
          // Get the subscription to extract metadata
          const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionStripeId);
          const subscriptionId = stripeSubscription.metadata?.subscription_id;

          if (subscriptionId) {
            await supabase.rpc("edge_subscriptions", {
              p_action: "update_subscription",
              p_payload: {
                id: subscriptionId,
                next_billing_date: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
                status: "active",
                stripe_invoice_id: invoice.id,
              },
            });

            logStep("Subscription activated via invoice", { subscriptionId });
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionStripeId = invoice.subscription as string | null;

        logStep("Invoice payment failed", { 
          invoiceId: invoice.id, 
          subscriptionId: subscriptionStripeId 
        });

        if (subscriptionStripeId) {
          await supabase.rpc("edge_subscriptions", {
            p_action: "update_subscription",
            p_payload: {
              status: "past_due",
              stripe_subscription_id: subscriptionStripeId,
            },
          });
        }
        break;
      }

      // ========== REFUND EVENTS ==========
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        logStep("Charge refunded", { chargeId: charge.id, refunded: charge.refunded });

        // Find order by payment intent
        const { data: orderResult } = await supabase.rpc("edge_orders", {
          p_action: "get_order_id_by_payment_intent",
          p_payload: {
            stripe_payment_intent_id: charge.payment_intent,
          },
        });

        const orderId = (orderResult as { order_id?: string | null } | null)?.order_id;

        if (orderId) {
          await supabase.rpc("edge_orders", {
            p_action: "update_order",
            p_payload: {
              order_id: orderId,
              status: charge.refunded ? "refunded" : "partially_refunded",
            },
          });
        }
        break;
      }

      // ========== DISPUTE EVENTS ==========
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;

        logStep("Dispute opened", {
          disputeId: dispute.id,
          chargeId: dispute.charge,
          amount: dispute.amount,
          reason: dispute.reason,
          status: dispute.status,
        });

        // Find order by payment intent
        const { data: disputeOrderResult } = await supabase.rpc("edge_stripe_disputes", {
          p_action: "find_order_by_payment_intent",
          p_payload: {
            stripe_payment_intent_id: dispute.payment_intent as string,
          },
        });

        const disputeOrder = disputeOrderResult as { order_id?: string | null; user_id?: string | null } | null;

        // Create dispute record
        await supabase.rpc("edge_stripe_disputes", {
          p_action: "upsert_dispute",
          p_payload: {
            amount: dispute.amount,
            currency: dispute.currency,
            evidence_due_by: dispute.evidence_details?.due_by
              ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
              : null,
            is_charge_refundable: dispute.is_charge_refundable,
            metadata: {
              network_reason_code: dispute.network_reason_code,
              payment_method_type: dispute.payment_method_details?.type,
            },
            order_id: disputeOrder?.order_id ?? null,
            reason: dispute.reason,
            status: dispute.status,
            stripe_charge_id: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id,
            stripe_dispute_id: dispute.id,
            stripe_payment_intent_id: dispute.payment_intent as string,
            user_id: disputeOrder?.user_id ?? null,
          },
        });

        // Update order dispute_status
        if (disputeOrder?.order_id) {
          await supabase.rpc("edge_orders", {
            p_action: "update_order",
            p_payload: {
              order_id: disputeOrder.order_id,
              status: "disputed",
            },
          });
        }

        // Audit log — critical severity for chargebacks
        await supabase.rpc("record_audit_log", {
          p_action: "dispute.created",
          p_details: {
            amount: dispute.amount,
            currency: dispute.currency,
            evidence_due_by: dispute.evidence_details?.due_by
              ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
              : null,
            reason: dispute.reason,
            stripe_charge_id: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id,
            stripe_dispute_id: dispute.id,
          },
          p_resource_id: disputeOrder?.order_id ?? dispute.id,
          p_resource_type: "dispute",
          p_user_id: disputeOrder?.user_id ?? null,
        });

        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;

        logStep("Dispute closed", {
          disputeId: dispute.id,
          status: dispute.status,
          reason: dispute.reason,
        });

        // Update dispute record
        await supabase.rpc("edge_stripe_disputes", {
          p_action: "update_status",
          p_payload: {
            closed_at: new Date().toISOString(),
            status: dispute.status,
            stripe_dispute_id: dispute.id,
          },
        });

        // If dispute was won, restore order status
        const { data: closedDisputeOrderResult } = await supabase.rpc("edge_stripe_disputes", {
          p_action: "find_order_by_payment_intent",
          p_payload: {
            stripe_payment_intent_id: dispute.payment_intent as string,
          },
        });

        const closedDisputeOrder = closedDisputeOrderResult as { order_id?: string | null; user_id?: string | null } | null;

        if (closedDisputeOrder?.order_id) {
          const newOrderStatus = dispute.status === "won" ? "paid" : "dispute_lost";
          await supabase.rpc("edge_orders", {
            p_action: "update_order",
            p_payload: {
              order_id: closedDisputeOrder.order_id,
              status: newOrderStatus,
            },
          });
        }

        // Audit log
        await supabase.rpc("record_audit_log", {
          p_action: `dispute.${dispute.status}`,
          p_details: {
            reason: dispute.reason,
            status: dispute.status,
            stripe_dispute_id: dispute.id,
          },
          p_resource_id: closedDisputeOrder?.order_id ?? dispute.id,
          p_resource_type: "dispute",
          p_user_id: closedDisputeOrder?.user_id ?? null,
        });

        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
});
