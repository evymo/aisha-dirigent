<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h2>${kcSanitize(msg("passwordResetSubject"))?no_esc}</h2>
  <p>${kcSanitize(msg("passwordResetBody",link, linkExpirationFormatter(linkExpiration)))?no_esc}</p>
  <p style="color: #6b7280;">Tým AISHA — Bezpečnost a soukromí na prvním místě</p>
</@layout.emailLayout>
