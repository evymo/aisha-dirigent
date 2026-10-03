<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:${msg("emailInk")};">${msg("emailVerificationCodeTitle")}</h1>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${msg("emailBody")};">${msg("emailVerificationCodeBody")}</p>

  <div style="border:1px dashed ${msg("emailBorder")};border-radius:12px;padding:20px;background:${msg("emailBgSoft")};margin:24px 0;">
    <p style="margin:0 0 8px;font-size:14px;color:${msg("emailInk")};font-weight:600;">${msg("emailOtpLabel")}</p>
    <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:${msg("emailInk")};text-align:center;padding:12px 0;">${code}</div>
    <p style="margin:8px 0 0;font-size:12px;color:${msg("emailMuted")};text-align:center;">${msg("emailOtpExpiry")}</p>
  </div>

  <p style="margin:20px 0 0;font-size:13px;color:${msg("emailMuted")};">${msg("emailIgnore")}</p>

  <p style="margin:16px 0 0;font-size:12px;color:${msg("emailSubtle")};">${msg("emailExpiry", linkExpiration)}</p>
</@layout.emailLayout>
