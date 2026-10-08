#!/usr/bin/env perl
use strict;
use warnings;

while (<>) {
    # admin email (broken JS expr that always fell through to literal)
    s/admin\@aisha\.guru \|\| 'admin\@aisha\.guru'/\$env?.AISHA_ADMIN_EMAIL || ''/g;
    # n8n webhook base URL — collapsed double-wrapped fallback
    s/\$env\.N8N_WEBHOOK_BASE_URL \|\| \(\$env\?\.N8N_WEBHOOK_BASE_URL \|\| 'https:\/\/n8n\.aisha\.guru'\)/\$env?.N8N_WEBHOOK_BASE_URL || ''/g;
    # n8n webhook base URL — single-wrapped fallback
    s/\$env\?\.N8N_WEBHOOK_BASE_URL \|\| 'https:\/\/n8n\.aisha\.guru'/\$env?.N8N_WEBHOOK_BASE_URL || ''/g;
    # verdaccio / npm registry
    s/\$env\?\.VERDACCIO_URL \|\| 'https:\/\/npm\.id3a\.cz'/\$env?.VERDACCIO_URL || ''/g;
    # MCP postgrest API (most common — 60+ hits)
    s/\|\| 'https:\/\/api\.backend\.id3a\.cz'/|| ''/g;
    print;
}
