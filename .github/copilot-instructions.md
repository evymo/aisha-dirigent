# Copilot Instructions — AI Platform

> Auto-generated from AISHA Expert Overlay ruleset.
> **Do not edit manually** — regenerate via AISHA Dirigent or `npm run gen:ide`.
> Generated: 2026-05-28T00:26:34.174Z
## 🎯 Project

**Scope:** Default rule set

---

## ⚠️ Expert Rules

### Code Quality

#### No Regressions

Every change must be verified to not break existing functionality.
Run the full test suite before committing. If a test fails, fix it before proceeding.
Never comment out or skip failing tests to make a commit pass.

#### Separation of Concerns

Each function, module, or class should have a single, well-defined responsibility.
Extract reusable logic into dedicated functions or modules.
Avoid mixing I/O, business logic, and presentation in a single unit.

#### Clear Naming

Use descriptive, intention-revealing names for variables, functions, and types.
Avoid abbreviations unless universally understood (e.g., `id`, `url`).
Boolean variables should read as questions: `isActive`, `hasPermission`, `canEdit`.

#### DRY — Don't Repeat Yourself

Avoid duplicating logic. If the same pattern appears 3+ times, extract it.
However, prefer duplication over premature abstraction — extract only when the pattern is stable.

### Testing

#### Test All New Code

Every new function, endpoint, or feature must have corresponding tests.
Tests should verify both the happy path and important edge cases / error conditions.
Prefer small, focused tests over large integration tests.

#### Stable Tests

Tests must be deterministic — no flaky tests that sometimes pass, sometimes fail.
Avoid relying on external services, network, or timing in unit tests.
Mock external dependencies at the boundary.

### Security

#### No Secrets in Code

Never commit passwords, API keys, tokens, or other credentials to the repository.
Use environment variables or secret management services for sensitive values.
Add sensitive file patterns to .gitignore (e.g., .env, *.pem, *.key).

#### Validate All Input

Validate and sanitize all input at system boundaries (API endpoints, form inputs, file uploads).
Use parameterized queries or ORM methods — never construct SQL/queries from user input strings.
Reject unexpected input shapes rather than trying to coerce them.

#### Principle of Least Privilege

Grant only the minimum permissions necessary for each operation.
Default to deny — require explicit permission grants.
Service accounts and database roles should have scoped, minimal access.

### Architecture

#### SOLID Principles

**Single Responsibility:** Each module/class has one reason to change.
**Open/Closed:** Open for extension, closed for modification.
**Liskov Substitution:** Subtypes must be substitutable for base types.
**Interface Segregation:** Prefer small, specific interfaces over large ones.
**Dependency Inversion:** Depend on abstractions, not concrete implementations.

#### Service-Oriented Design

Structure the codebase as services or modules that communicate through well-defined interfaces.
Keep coupling between modules low and cohesion within modules high.
Document public API contracts — changes to interfaces require versioning or migration.

### Git Workflow

#### Small, Focused Commits

Each commit should represent a single logical change.
Write clear commit messages: type(scope): short description.
Avoid mixing unrelated changes in a single commit.

#### Review Before Merge

All code changes should be reviewed before merging to the main branch.
Run the full test suite and build before pushing.
Address review feedback before merging — don't defer fixes to later commits.

---

## 📋 PR Checklist

- [ ] All expert rules followed
- [ ] `npm run test:run` — all tests passing
- [ ] `npm run build` — successful
- [ ] `npm run lint` — no errors
- [ ] No hardcoded text in JSX (use i18n)
- [ ] No `any` types
- [ ] No `console.log` in production code



<!-- gen:metadata {"story_id":null,"output_path":".github/copilot-instructions.md","length_chars":null,"adapter":"copilot","payload_version":1,"fingerprint":null,"generated_at":"2026-05-28T00:26:34.174Z"} -->
