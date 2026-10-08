---
slug: definer-search-path-ends-with-pg-temp
title: "A SECURITY DEFINER function's search_path ends with pg_temp"
summary: "A SECURITY DEFINER function pins its search_path and lists pg_temp last; otherwise a temporary relation of the caller can shadow an unqualified table inside the function."
category: database_security
item_type: playbook
tags: [postgres, security-definer, search-path]
verified: read
verified_note: "follows the PostgreSQL documentation on writing SECURITY DEFINER functions safely; not re-run for this item"
evidence:
  - "PostgreSQL documentation, CREATE FUNCTION, section 'Writing SECURITY DEFINER Functions Safely'"
valid_for: "PostgreSQL"
scope: general
status: proposed
author: platform-maintainers
ai_instructions: "When writing or reviewing a SECURITY DEFINER function, pin its search_path and make pg_temp the last entry; schema-qualify the objects it touches."
---
# A SECURITY DEFINER function's search_path ends with pg_temp

## Rules
1. **Pin search_path and list `pg_temp` last.** [read] A temporary schema not listed explicitly is searched first; a caller's temporary table would then shadow an unqualified table inside the function.
2. **Schema-qualify what the function touches.** [read] Qualification makes the function independent of search_path order.
