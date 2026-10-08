<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h2>${kcSanitize(msg("emailVerificationSubject"))?no_esc}</h2>
  <p>${kcSanitize(msg("emailVerificationBody",link, linkExpirationFormatter(linkExpiration)))?no_esc}</p>
  <p style="color: #6b7280; font-size: 0.875rem;">AISHA Platform</p>
</@layout.emailLayout>
