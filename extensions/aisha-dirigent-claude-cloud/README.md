# AISHA Dirigent — Claude review draft

AISHA Dirigent connects your own AISHA account to project context, assigned work, published expert guidance, IDE instructions and audited progress handoffs. Choose the accessible project before reading its context or recording progress. Empty results are reported honestly; permission errors do not trigger administrative credential fallback.

This draft contains a skill and a fixed HTTPS remote MCP connection. It runs no local server, installation command, background task or session hook. Information and authorized progress entries are exchanged with the AISHA API at api.aisha.guru; sign-in belongs to AISHA ID at auth.aisha.guru. Cloud chat returns proposed IDE instructions; changing files on a development machine requires a local session and authorized target workspace. Automation configuration and execution require the existing AISHA project permissions and approval workflow.

**Review status:** package syntax validation does not establish OAuth compatibility. Hosted Claude client registration, hosted callback verification, connection and refresh testing remain required. No Claude directory submission or installation has been performed. The existing local AISHA Dirigent 0.7.0 plugin is a different artifact; do not install both under the same identifier in one marketplace.

## Privacy and support

[Privacy policy](https://web.aisha.guru/privacy) · [Terms](https://web.aisha.guru/terms) · [AISHA website and support](https://web.aisha.guru/#contact). Confirm the public documentation and support destinations are suitable for reviewers before submission.

## Source for directory review

The review source is this folder on the dedicated GitHub review branch, not the
repository root marketplace. The root marketplace continues to describe the
existing local plugin. The cloud draft keeps the product package name
`aisha-dirigent`; it is not a compatible replacement for the local 0.7.0 server.
Do not add both to one marketplace under that identifier. Choose the source
explicitly for review and keep automatic publication disabled until review.

Prepared backend metadata changes are tracked separately in the private backend
review. Package validation does not prove that those changes have been deployed.
