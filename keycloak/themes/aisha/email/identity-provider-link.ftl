<#import "template.ftl" as layout>
<@layout.emailLayout>
  <h2>${kcSanitize(msg("identityProviderLinkSubject"))?no_esc}</h2>
  <p>${kcSanitize(msg("identityProviderLinkBody", identityProviderAlias, link, linkExpirationFormatter(linkExpiration)))?no_esc}</p>
</@layout.emailLayout>
