<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:${msg("emailInk")};">${msg("executeActionsTitle")}</h1>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${msg("emailBody")};">${msg("executeActionsBody")}</p>

  <div style="text-align:center;margin:24px 0;">
    <a href="${link}" style="display:inline-block;background:${msg("emailAccent")};color:${msg("emailAccentInk")};text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;">${msg("executeActionsButton")}</a>
  </div>

  <p style="margin:24px 0 8px;font-size:12px;color:${msg("emailMuted")};word-break:break-all;">
    <a href="${link}" style="color:${msg("emailMuted")};text-decoration:underline;word-break:break-all;">${link}</a>
  </p>

  <p style="margin:20px 0 0;font-size:13px;color:${msg("emailMuted")};">${msg("emailIgnore")}</p>

  <p style="margin:16px 0 0;font-size:12px;color:${msg("emailSubtle")};">${msg("emailExpiry", linkExpiration)}</p>
</@layout.emailLayout>
