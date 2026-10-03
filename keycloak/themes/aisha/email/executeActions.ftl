<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h2>${kcSanitize(msg("executeActionsSubject"))?no_esc}</h2>
  <p>${kcSanitize(msg("executeActionsBody",link, linkExpirationFormatter(linkExpiration)))?no_esc}</p>
  <p style="color: #6b7280;">AISHA — Vaše akce vyžaduje potvrzení</p>
</@layout.emailLayout>
