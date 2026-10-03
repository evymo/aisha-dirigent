<#macro emailLayout>
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>AISHA</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <img src="${url.resourcesUrl}/img/logo.png" alt="AISHA" style="height: 48px; margin-bottom: 24px;">
    <#nested>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
    <p style="color: #64748b; font-size: 0.875rem; text-align: center;">
      AISHA Platform • ${.now?date}
    </p>
  </div>
</body>
</html>
</#macro>
