{
  "Stuns": [{{#stun_turn}}
    {
      "Proto": "udp",
      "URI": "stun:${NETBIRD_DOMAIN}:3478",
      "Username": "",
      "Password": null
    }
  {{/stun_turn}}],
  "TURNConfig": {
    "Turns": [{{#stun_turn}}
      {
        "Proto": "udp",
        "URI": "turn:${NETBIRD_DOMAIN}:3478",
        "Username": "${NETBIRD_TURN_USERNAME}",
        "Password": "${NETBIRD_TURN_PASSWORD}"
      }
    {{/stun_turn}}],
    "CredentialsTTL": "12h",
    "Secret": "{{#stun_turn}}${NETBIRD_TURN_PASSWORD}{{/stun_turn}}",
    "TimeBasedCredentials": false
  },
  "Relay": {
    "Addresses": ["{{RELAY}}"],
    "CredentialsTTL": "24h",
    "Secret": "${NETBIRD_RELAY_SECRET}"
  },
  "Signal": {
    "Proto": "https",
    "URI": "{{SIGNAL}}",
    "Username": "",
    "Password": null
  },
  "DataDir": "/var/lib/netbird",
  "DataStoreEncryptionKey": "${NETBIRD_DATASTORE_ENC_KEY}",
  "StoreConfig": {
    "Engine": "postgres"
  },
  "HttpConfig": {
    "Address": "0.0.0.0:443",
    "AuthIssuer": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}",
    "AuthAudience": "${NETBIRD_OIDC_CLIENT_ID}",
    "AuthKeysLocation": "${KEYCLOAK_URL_FROM_CLUSTER}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs",
    "AuthUserIDClaim": "sub",
    "_pozn_OIDCConfigEndpoint": "ODSTRANĚN 2026-08-25. NetBird si z discovery dokumentu PŘEPÍŠE AuthKeysLocation (management.go:263) — a Keycloak v něm inzeruje VEŘEJNÝ jwks_uri, protože tak ho vidí prohlížeč. Management tím zahodil správnou vnitřní adresu, sáhl na veřejnou tvář (kterou obsluhuje edge, jenž přichází až PO meshi), dostal 503 s tělem 'no available server', pokusil se ho parsovat jako JSON ('invalid character o in literal null'), zůstal bez klíčů a odmítl KAŽDÝ token. Backchannel (management→KC) je VNITŘNÍ, frontchannel (prohlížeč/notebook→KC) je VEŘEJNÝ; discovery ten rozdíl slévalo. Device flow proto níž nese vlastní veřejné endpointy.",
    "IdpSignKeyRefreshEnabled": true
  },
  "IdpManagerConfig": {
    "ManagerType": "keycloak",
    "ClientConfig": {
      "Issuer": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}",
      "TokenEndpoint": "${KEYCLOAK_URL_FROM_CLUSTER}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token",
      "ClientID": "{{IDP}}",
      "ClientSecret": "${NETBIRD_MGMT_SECRET}",
      "GrantType": "client_credentials"
    },
    "ExtraConfig": {
      "AdminEndpoint": "${KEYCLOAK_URL_FROM_CLUSTER}/admin/realms/${KEYCLOAK_REALM}"
    }
  }{{#peer_sso}},
  "DeviceAuthorizationFlow": {
    "Provider": "hosted",
    "ProviderConfig": {
      "Audience": "${NETBIRD_OIDC_CLIENT_ID}",
      "Domain": "${KEYCLOAK_DOMAIN_PUBLIC}",
      "ClientID": "${NETBIRD_OIDC_CLIENT_ID}",
      "TokenEndpoint": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token",
      "DeviceAuthEndpoint": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth/device"
    }
  },
  "PKCEAuthorizationFlow": {
    "ProviderConfig": {
      "Audience": "${NETBIRD_OIDC_CLIENT_ID}",
      "ClientID": "${NETBIRD_OIDC_CLIENT_ID}",
      "Domain": "${KEYCLOAK_DOMAIN_PUBLIC}",
      "AuthorizationEndpoint": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth",
      "TokenEndpoint": "https://${KEYCLOAK_DOMAIN_PUBLIC}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token",
      "Scope": "openid profile email offline_access api",
      "RedirectURLs": ["http://localhost:53000/", "http://localhost:54000/"]
    }
  }{{/peer_sso}}
}
