/**
 * SMS OTP Edge Function
 *
 * Sends OTP codes via SMS using configured SMS provider
 * Supports: Twilio, MessageBird, Vonage
 *
 * Environment variables required:
 * - SMS_PROVIDER: "twilio" | "messagebird" | "vonage"
 *
 * For Twilio:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_PHONE_NUMBER or TWILIO_MESSAGE_SERVICE_SID
 *
 * For MessageBird:
 * - MESSAGEBIRD_ACCESS_KEY
 * - MESSAGEBIRD_ORIGINATOR
 *
 * For Vonage:
 * - VONAGE_API_KEY
 * - VONAGE_API_SECRET
 * - VONAGE_FROM
 */

import { serve, createClient } from "../_shared/deps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface OtpRequest {
  phone: string;
  otpLength?: number;
  expirySeconds?: number;
  template?: string;
  lang?: string;
}

interface OtpRecord {
  phone: string;
  code: string;
  expires_at: string;
  verified: boolean;
}

// Generate random numeric OTP
function generateOtp(length: number = 6): string {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

// Send SMS via Twilio
async function sendViaTwilio(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGE_SERVICE_SID");

  if (!accountSid || !authToken) {
    return { success: false, error: "Twilio credentials not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append("To", phone);
  formData.append("Body", message);

  if (messagingServiceSid) {
    formData.append("MessagingServiceSid", messagingServiceSid);
  } else if (fromNumber) {
    formData.append("From", fromNumber);
  } else {
    return { success: false, error: "No Twilio sender configured" };
  }

  try {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.message || `Twilio error: ${response.status}`,
      };
    }

    return { success: true, messageId: data.sid };
  } catch (error) {
    return { success: false, error: `Twilio request failed: ${error.message}` };
  }
}

// Send SMS via MessageBird
async function sendViaMessageBird(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accessKey = Deno.env.get("MESSAGEBIRD_ACCESS_KEY");
  const originator = Deno.env.get("MESSAGEBIRD_ORIGINATOR") || "Platform";

  if (!accessKey) {
    return { success: false, error: "MessageBird credentials not configured" };
  }

  const url = "https://rest.messagebird.com/messages";

  try {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        Authorization: `AccessKey ${accessKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        originator,
        recipients: [phone],
        body: message,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error:
          data.errors?.[0]?.description ||
          `MessageBird error: ${response.status}`,
      };
    }

    return { success: true, messageId: data.id };
  } catch (error) {
    return {
      success: false,
      error: `MessageBird request failed: ${error.message}`,
    };
  }
}

// Send SMS via Vonage
async function sendViaVonage(
  phone: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = Deno.env.get("VONAGE_API_KEY");
  const apiSecret = Deno.env.get("VONAGE_API_SECRET");
  const from = Deno.env.get("VONAGE_FROM") || "Platform";

  if (!apiKey || !apiSecret) {
    return { success: false, error: "Vonage credentials not configured" };
  }

  const url = "https://rest.nexmo.com/sms/json";

  try {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        api_secret: apiSecret,
        from,
        to: phone.replace("+", ""),
        text: message,
      }),
    });

    const data = await response.json();
    const msg = data.messages?.[0];

    if (msg?.status !== "0") {
      return {
        success: false,
        error: msg?.["error-text"] || `Vonage error: ${msg?.status}`,
      };
    }

    return { success: true, messageId: msg?.["message-id"] };
  } catch (error) {
    return { success: false, error: `Vonage request failed: ${error.message}` };
  }
}

// Main handler
serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: OtpRequest = await req.json();
    const { phone, otpLength = 6, expirySeconds = 300, template, lang = "en" } = body;

    // Validate phone
    if (!phone || !/^\+\d{10,15}$/.test(phone)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number. Use E.164 format (+420123456789)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate OTP
    const code = generateOtp(otpLength);
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);

    // Build message
    let message: string;
    if (template) {
      message = template.replace("{code}", code);
    } else {
      // Default messages by language
      const messages: Record<string, string> = {
        cs: `Váš ověřovací kód Platform: ${code}`,
        en: `Your Platform verification code: ${code}`,
        de: `Ihr Platform Verifizierungscode: ${code}`,
      };
      message = messages[lang] || messages.en;
    }

    // Determine provider
    const provider = Deno.env.get("SMS_PROVIDER") || "twilio";

    let result: { success: boolean; messageId?: string; error?: string };

    switch (provider) {
      case "messagebird":
        result = await sendViaMessageBird(phone, message);
        break;
      case "vonage":
        result = await sendViaVonage(phone, message);
        break;
      case "twilio":
      default:
        result = await sendViaTwilio(phone, message);
        break;
    }

    if (!result.success) {
      console.error(`SMS send failed: ${result.error}`);
      return new Response(
        JSON.stringify({ error: result.error || "Failed to send SMS" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Store OTP in database for verification
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Upsert OTP record (invalidates previous OTP for this phone)
    const { error: dbError } = await supabase.rpc("edge_sms_otp", {
      p_action: "upsert",
      p_payload: {
        code,
        expires_at: expiresAt.toISOString(),
        phone,
        verified: false,
      },
    });

    if (dbError) {
      console.error("Failed to store OTP:", dbError);
      // Continue anyway - SMS was sent
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: result.messageId,
        expiresAt: expiresAt.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("SMS OTP error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
