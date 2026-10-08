---
slug: model-access-architecture
title: "How a fork reaches models: never directly, only through its own Aisha and its own model mesh"
summary: "Models are an internal organ of Aisha. Each fork reaches a shared model lane only from its own Aisha, through a separate per-fork model mesh whose control plane runs at the fork; the GPU node is only a stateless peer."
category: architecture
item_type: engineering_doc
tags: [models, gpu, mesh, isolation, routing, lens, knowledge-base]
verified: read
verified_note: "design decided by the platform owner on 2026-10-05 with conditions from the operator of the shared layer and from operations; recorded in a private review repository; check the implementation and its doctor before relying on any rule"
evidence:
  - "owner decisions of 2026-10-05 (routing, per-fork lens and knowledge base, per-fork model mesh, the accepted variant) and the mesh contract with its conditions, recorded in a private review repository"
  - "procedure: once implemented, the fork's doctor must report a missing GPU peer loudly and must find no model endpoint reachable from outside the fork's edge"
valid_for: "design from 2026-10-05; until the owner changes the model-access design"
scope: general
status: adopted
author: platform-maintainers
ai_instructions: "When designing, reviewing or operating anything that calls a model, check that the call comes from the fork's own Aisha through its own model mesh; refuse any design that exposes a model endpoint publicly, to another fork, or to a client other than the fork's Aisha."
---
# How a fork reaches models

## Rules
1. **[read] Models are never exposed directly.** No public endpoint, no endpoint shared between forks. To the outside world the "model" is Aisha herself; external clients (gateway services and others) reach Aisha only through the fork's edge.
2. **[read] Routing to models belongs only to the fork's Aisha:** which model, which lens, what is allowed, which budget.
3. **[read] Bases are shared, lens and knowledge are per fork.** Base models (chat, embedding, rerank) are loaded once on the shared lane; every fork has its own adapter (lens), trained only on its data, and its own knowledge base stored in its own database. The shared embedder computes on the fork's request; vectors are stored at the fork.
4. **[read] One access mode: a separate model mesh per fork.** Its control plane runs at the fork (a second instance of the same mesh stack, generated from the same declaration, backed up the same way, using the fork's identity provider), published through the fork's edge with UDP as an explicit exception. The GPU node joins it as a stateless peer with outbound connections only; it never joins the fork's main mesh. No silent fallback to another mode; the fork's doctor reports loudly when the GPU peer is missing.
5. **[read] The node enforces locally what a fork's control plane could push:** per-fork mesh client in its own network namespace (no SSH server, no routes, no DNS takeover, no host LAN), per-fork entry into the lane, only the fork's dispatch and the GPU peer in the model mesh (dispatch to model only; the GPU peer initiates nothing), a local kill switch independent of the fork, one-time registration keys, adapters only as checksummed files addressed by the entry's identity, and the host firewall exactly as the node's declaration states it (never changed on your own).
6. **[read] The model mesh has its own identity setup:** its own OIDC client and audience for administrators, and peers join only with a one-time registration key (single sign-on and device flow for peers disabled). The fork's two control planes are never confused, and the GPU peer is never in the main mesh.
7. **[read] One bridge per fork** (a model gateway sidecar) is the only point where the main and model meshes touch; the doctor must measure it.
8. **[read] Accepted residual risk:** a compromised control plane of one fork can add peers to its own model mesh, but they reach only that fork's entry within its quota, never another fork.

## Why
Isolation by shape instead of by access lists, a stateless shared GPU node without public entry, and identity checks staying with each fork. Two views disagreed (operations: no state and no public entry on the node; the layer's owner: the node must never sit in a fork's main mesh); this variant satisfies both.
