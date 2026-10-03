<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h2>${kcSanitize(msg("eventLoginSubject"))?no_esc}</h2>
  <p>${kcSanitize(msg("eventLoginBody", event.date, event.ipAddress))?no_esc}</p>
  <p style="color: #6b7280; font-size: 0.875rem;">AISHA Security Alert</p>
</@layout.emailLayout>
