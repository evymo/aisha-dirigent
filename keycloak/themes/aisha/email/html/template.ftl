<#macro emailLayout>
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background-color:${msg("emailBg")};font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${msg("emailInk")};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${msg("emailBg")};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${msg("emailBorder")};">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:${msg("emailBgSoft")};border-bottom:1px solid ${msg("emailBorder")};">
              <img src="${url.resourcesUrl}/img/logo.png" alt="AISHA ID" height="32" style="display:block;border:0;"/>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:32px;">
              <#nested>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:${msg("emailBgSoft")};border-top:1px solid ${msg("emailBorder")};font-size:12px;color:${msg("emailMuted")};">
              <p style="margin:0 0 6px;">${msg("emailFooterHelp")} __SUPPORT_EMAIL__.</p>
              <p style="margin:0;">AISHA ID</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>
