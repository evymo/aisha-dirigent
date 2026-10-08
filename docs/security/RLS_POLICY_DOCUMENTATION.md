# RLS Policy Documentation - Platform

**Document Version:** 1.0  
**Last Updated:** 2025-12-20  
**Classification:** security compliance Audit Documentation  
**Prepared for:** Security Audit / Compliance Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Role Matrix](#2-role-matrix)
3. [Helper Functions](#3-helper-functions)
4. [sensitive-data/Activity Data Tables](#4-phihealth-data-tables)
5. [User Management Tables](#5-user-management-tables)
6. [Partner & Appointments](#6-partner--appointments)
7. [Studies & Research](#7-studies--research)
8. [Orders & Shop](#8-orders--shop)
9. [Admin & Audit](#9-admin--audit)
10. [Archive & Documents](#10-archive--documents)
11. [Token System](#11-token-system)
12. [Security Best Practices Summary](#12-security-best-practices-summary)

---

## 1. Executive Summary

### Overview

Platform implements a comprehensive Row Level Security (RLS) strategy in PostgreSQL/Supabase to protect sensitive data and ensure compliance. The system uses:

- **Role-Based Access Control (RBAC)** with 5 primary roles
- **Dynamic Permission System** mapping roles to fine-grained permissions
- **Data Sharing Consent** mechanism for sensitive data access by production providers
- **Helper Functions** (SECURITY DEFINER) for consistent access checks

### Key Security Principles

| Principle | Implementation |
|-----------|----------------|
| **Least Privilege** | Users can only access their own data by default |
| **Consent-Based sensitive data Access** | Consultants require explicit `data_sharing_consents` to view user data |
| **Admin Segregation** | Admin/staff access through dedicated policies, audited |
| **RLS on ALL Tables** | Every public table has `ENABLE ROW LEVEL SECURITY` |
| **No SECURITY DEFINER Bypass** | RLS policies never bypass security; only helper functions use DEFINER |

### Statistics

- **Total Tables with RLS:** 60+ tables
- **Total Policies:** 300+ policies
- **secure-Protected Tables:** 8 critical tables
- **Role-Permission Mappings:** Dynamic via `role_permissions` table

---

## 2. Role Matrix

### Available Roles (`app_role` enum)

| Role | Description | sensitive data Access | Admin Access |
|------|-------------|------------|--------------|
| `admin` | Full system administrator | ✅ Full | ✅ Full |
| `staff` | Operations staff | ✅ View | ✅ Limited |
| `practitioner` | Production provider / Partner | ✅ With Consent | ❌ |
| `member` | Regular platform user | Own Data Only | ❌ |
| `evaluator` | Study evaluator (limited role) | ❌ | ❌ |

### Role Hierarchy

```
admin
  ├── staff (inherits read access)
  └── practitioner (separate consent-based access)
member (base role, own data only)
evaluator (specialized, limited scope)
```

### Role Capabilities (from `roles` table)

| Capability | admin | staff | practitioner | member | evaluator |
|------------|-------|-------|--------------|--------|-----------|
| `is_admin` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `can_manage_users` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `can_manage_roles` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `can_view_phi` | ✅ | ✅ | With Consent | Own | ❌ |
| `can_export_phi` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `can_break_glass` | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 3. Helper Functions

### Core Authorization Functions

All helper functions use `SECURITY DEFINER` with `SET search_path = public` for security.

#### `has_role(p_user_id UUID, p_role TEXT)`
Checks if user has specific role.

```sql
SELECT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = p_user_id
  AND role::text = p_role
);
```

**Used in:** Role-based policies, admin access checks

#### `is_admin_or_staff(p_user_id UUID DEFAULT auth.uid())`
Checks if user is admin or staff member.

```sql
SELECT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = p_user_id
  AND role IN ('admin', 'staff')
);
```

**Used in:** sensitive data access policies, management operations

#### `has_section_access(p_user_id UUID, p_section TEXT, p_permission TEXT)`
Checks admin section access via `role_permissions` table.

```sql
SELECT EXISTS (
  SELECT 1 
  FROM public.role_permissions rp
  JOIN public.user_roles ur ON ur.role = rp.role
  WHERE ur.user_id = p_user_id
  AND rp.section::text = p_section
  AND rp.permission::text = p_permission
);
```

**Used in:** Admin panel access control

#### `has_data_sharing_consent(_user_id UUID, _partner_user_id UUID)`
Checks if partner has explicit consent to access user's sensitive data.

```sql
SELECT EXISTS (
  SELECT 1
  FROM data_sharing_consents dsc
  JOIN partner_profiles pp ON pp.id = dsc.partner_id
  WHERE dsc.user_id = _user_id
    AND pp.user_id = _partner_user_id
    AND dsc.revoked_at IS NULL
);
```

**Used in:** All secure-related consultant access policies

#### `is_consultant_for_user(p_user_id UUID)` / `is_consultant_for_registration(p_registration_id UUID)`
Checks consultant relationship for data access.

**Used in:** sensitive data access for consultants

---

## 4. sensitive-data/Activity Data Tables

### 🔐 `health_check_ins` - Daily Activity Tracking

**Sensitivity:** HIGH (sensitive-data - sensitive data)  
**Contains:** Pain levels, mood, sleep quality, symptoms, medications

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own check-ins | SELECT | `auth.uid() = user_id` |
| Users can create their own check-ins | INSERT | `auth.uid() = user_id` |
| Users can update their own check-ins | UPDATE | `auth.uid() = user_id` |
| Admins can view all check-ins | SELECT | `is_admin_or_staff(auth.uid())` |
| Consultants can view consented users check-ins | SELECT | `is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())` |

**Security Notes:**
- ✅ No DELETE policy - check-ins are immutable for audit trail
- ✅ Consultant access requires explicit consent
- ✅ Admin access is logged in `audit_journal`

---

### 🔐 `lab_results` - Laboratory Test Results

**Sensitivity:** HIGH (sensitive-data - Medical Records)  
**Contains:** Blood tests, inflammation markers, metabolic data

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own lab results | SELECT | `auth.uid() = user_id` |
| Users can create their own lab results | INSERT | `auth.uid() = user_id` |
| Admins can view all lab results | SELECT | `is_admin_or_staff(auth.uid())` |
| Admins can manage all lab results | ALL | `is_admin_or_staff(auth.uid())` |
| Consultants can view consented users lab results | SELECT | `is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())` |

---

### 🔐 `activity_logs` - Product Dosing Records

**Sensitivity:** HIGH (sensitive-data - Treatment Records)  
**Contains:** Medication doses, timestamps, side effects

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own dosing logs | SELECT | `auth.uid() = user_id` |
| Users can create their own dosing logs | INSERT | `auth.uid() = user_id` |
| Admins can view all dosing logs | SELECT | `is_admin_or_staff(auth.uid())` |
| Consultants can view consented users dosing logs | SELECT | `is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())` |

---

### 🔐 `member_health_documents` - Uploaded Medical Documents

**Sensitivity:** CRITICAL (sensitive-data - Medical Records)  
**Contains:** Uploaded lab reports, medical documents, prescriptions

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own documents | SELECT | `auth.uid() = user_id` |
| Users can upload their own documents | INSERT | `auth.uid() = user_id` |
| Admins can manage all documents | ALL | `is_admin_or_staff(auth.uid())` |
| Partners with consent can view | SELECT | Via `document_sharing_permissions` table |

**Additional Protection:** `document_sharing_permissions` table controls per-document sharing.

---

### 🔐 `wearables_data` - Device Integration Data

**Sensitivity:** HIGH (sensitive-data - Biometric Data)  
**Contains:** Heart rate, HRV, sleep patterns, activity data

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own wearables data | SELECT | `auth.uid() = user_id` |
| Users can create their own wearables data | INSERT | `auth.uid() = user_id` |
| Admins can view all wearables data | SELECT | `is_admin_or_staff(auth.uid())` |

---

## 5. User Management Tables

### `profiles` - User Profile Information

**Sensitivity:** HIGH (Contains sensitive data fields: medical_history, allergies, medications)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own profile | SELECT | `auth.uid() = user_id` |
| Users can update their own profile | UPDATE | `auth.uid() = user_id` |
| Users can insert their own profile | INSERT | `auth.uid() = user_id` |
| Admins can view all profiles | SELECT | `is_admin_or_staff(auth.uid())` |

**sensitive-data Fields in profiles:**
- `primary_diagnosis`
- `medical_history`
- `current_medications`
- `allergies`
- `date_of_birth`

---

### `user_roles` - RBAC Role Assignments

**Sensitivity:** CRITICAL (Security Configuration)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own roles | SELECT | `auth.uid() = user_id` |
| Admins can view all roles | SELECT | `has_role(auth.uid(), 'admin')` |
| Admins can manage roles | ALL | `has_role(auth.uid(), 'admin')` |

**Security Notes:**
- ✅ Only `admin` role can modify roles (not staff)
- ✅ Role changes are tracked in `audit_journal`
- ✅ `granted_by` field records who assigned the role

---

### `consents` - User Consent Records

**Sensitivity:** HIGH (compliance Compliance)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own consents | SELECT | `auth.uid() = user_id` |
| Users can create their own consents | INSERT | `auth.uid() = user_id` |
| Admins can view all consents | SELECT | `is_admin_or_staff(auth.uid())` |
| Consultants can view consented users consents | SELECT | `is_consultant_for_user(user_id) AND has_data_sharing_consent(user_id, auth.uid())` |

**Consent Types:**
- `data_processing` - GDPR/data handling
- `observation` - Observational study participation
- `operational_trial` - Operational trial participation
- `wearables` - Wearable device data collection
- `marketing` - Marketing communications
- `informed_consent` - Study-specific informed consent

---

### `data_sharing_consents` - sensitive data Sharing Permissions

**Sensitivity:** CRITICAL (Controls sensitive data Access)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own data sharing consents | SELECT | `auth.uid() = user_id` |
| Users can create data sharing consents | INSERT | `auth.uid() = user_id` |
| Users can update their own data sharing consents | UPDATE | `auth.uid() = user_id` |
| Partners can view consents granted to them | SELECT | Partner match via `partner_profiles` |
| Admins can view all data sharing consents | SELECT | `is_admin_or_staff(auth.uid())` |

**Security Notes:**
- ✅ Users control their own consent grants
- ✅ `revoked_at` timestamp allows consent withdrawal
- ✅ Partners see only consents granted TO them

---

## 6. Partner & Appointments

### `partner_profiles` - Production Provider Profiles

**Sensitivity:** MEDIUM (Business Information)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Public partner profiles are viewable by everyone | SELECT | `is_visible = true` |
| Users can view their own partner profile | SELECT | `auth.uid() = user_id` |
| Users can create their own partner profile | INSERT | `auth.uid() = user_id` |
| Users can update their own partner profile | UPDATE | `auth.uid() = user_id` |
| Admins can view all partner profiles | SELECT | `is_admin_or_staff(auth.uid())` |
| Admins can manage all partner profiles | ALL | `is_admin_or_staff(auth.uid())` |

**Visibility Control:**
- Only certified partners (`certification_passed_at IS NOT NULL`) can be publicly visible
- `is_visible` flag controls public listing

---

### `partner_appointments` - Appointment Scheduling

**Sensitivity:** MEDIUM (Contains user-partner relationships)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Partners can view appointments with them | SELECT | Partner match via `partner_profiles` |
| Members can view their own appointments | SELECT | `auth.uid() = member_id` |
| Members can create appointments | INSERT | `auth.uid() = member_id` |
| Involved parties can update appointments | UPDATE | Member OR Partner match |
| Admins can manage all appointments | ALL | `is_admin_or_staff(auth.uid())` |

---

### `partner_availability` - Scheduling Availability

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Partner availability is viewable by everyone | SELECT | `true` (public) |
| Partners can manage their own availability | ALL | Own partner profile match |

---

### `partner_appointment_notes` - Appointment Notes

**Sensitivity:** HIGH (May contain sensitive-data)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Members can view own appointment notes | SELECT | Own appointment match |
| Members can insert own appointment notes | INSERT | Own appointment match |
| Members can update own appointment notes | UPDATE | Own appointment match |
| Admins can manage all appointment notes | ALL | `is_admin_or_staff(auth.uid())` |

---

## 7. Studies & Research

### `studies` - Research Studies

**Sensitivity:** LOW (Public study information)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Studies are viewable by everyone | SELECT | `true` (public) |
| Admins can manage studies | ALL | `is_admin_or_staff(auth.uid())` |

---

### `program_registrations` - Study Participation

**Sensitivity:** HIGH (Links users to medical studies)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own registrations | SELECT | `auth.uid() = user_id` |
| Users can create their own registrations | INSERT | `auth.uid() = user_id` |
| Users can update their own registrations | UPDATE | `auth.uid() = user_id` |
| Admins can view all study registrations | SELECT | `is_admin_or_staff(auth.uid())` |
| Admins can manage all study registrations | ALL | `is_admin_or_staff(auth.uid())` |

---

### `study_consultants` - Study Partner Assignments

**Sensitivity:** MEDIUM (Study-partner relationships)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Study consultants are publicly visible | SELECT | `status = 'approved'` |
| Partners can view their own consultant status | SELECT | Own partner profile match |
| Partners can apply as consultants | INSERT | Own partner profile match |
| Admins can manage consultants | ALL | `is_admin_or_staff(auth.uid())` |

---

### `study_ratings` - Study Reviews

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Visible ratings can be read by everyone | SELECT | `is_visible = true` |
| Users can view their own ratings | SELECT | `auth.uid() = user_id` |
| Users can create ratings for studies they participated in | INSERT | User + registration validation |
| Users can update their own ratings | UPDATE | `auth.uid() = user_id` |
| Admins can manage all ratings | ALL | `is_admin_or_staff(auth.uid())` |

**Security Notes:**
- ✅ Consultants cannot rate studies they manage (blocked by policy)
- ✅ Only enrolled/completed users can rate

---

### `questionnaire_responses` - Study Questionnaire Answers

**Sensitivity:** HIGH (May contain health information)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own questionnaire responses | SELECT | `auth.uid() = user_id` |
| Users can create their own questionnaire responses | INSERT | `auth.uid() = user_id` |
| Admins can view all questionnaire responses | SELECT | `is_admin_or_staff(auth.uid())` |
| Consultants can view consented users questionnaire responses | SELECT | Consent + consultant relationship |

---

## 8. Orders & Shop

### `products` - Product Catalog

**Sensitivity:** LOW (Public catalog)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Products are viewable by everyone | SELECT | `true` (public) |
| Admins can manage products | ALL | `is_admin_or_staff(auth.uid())` |

---

### `cart_items` - Shopping Cart

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own cart | SELECT | `auth.uid() = user_id` |
| Users can add to their own cart | INSERT | `auth.uid() = user_id` |
| Users can update their own cart | UPDATE | `auth.uid() = user_id` |
| Users can delete from their own cart | DELETE | `auth.uid() = user_id` |

---

### `orders` - Order Records

**Sensitivity:** MEDIUM (Contains addresses, purchase history)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own orders | SELECT | `auth.uid() = user_id` |
| Users can create their own orders | INSERT | `auth.uid() = user_id` |
| Admins can view all orders | SELECT | `is_admin_or_staff(auth.uid())` |
| Staff can update orders | UPDATE | `is_admin_or_staff(auth.uid())` |

---

### `order_items` - Order Line Items

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own order items | SELECT | Order ownership check |
| Users can create order items for their orders | INSERT | Order ownership check |

---

## 9. Admin & Audit

### `audit_journal` - Comprehensive Audit Trail

**Sensitivity:** CRITICAL (Security Audit Data)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Admins and staff can view audit journal | SELECT | `is_admin_or_staff(auth.uid())` |

**No INSERT/UPDATE/DELETE policies** - entries created only via `write_audit_journal()` SECURITY DEFINER function.

**Logged Events:**
- User authentication (login/logout)
- sensitive data access events
- Role changes
- Data modifications
- System events

---

### `role_permissions` - RBAC Permission Mappings

**Sensitivity:** CRITICAL (Security Configuration)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Admins can manage role permissions | ALL | `has_role(auth.uid(), 'admin')` |
| Authenticated users can view permissions | SELECT | `auth.uid() IS NOT NULL` |

---

### `permissions` - Permission Definitions

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Authenticated users can read permissions | SELECT | Authenticated |
| Only admins can modify | ALL | `has_role(auth.uid(), 'admin')` |

---

### `user_sessions` - Session Management

**Sensitivity:** HIGH (Security Data)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own sessions | SELECT | `auth.uid() = user_id` |
| Users can create their own sessions | INSERT | `auth.uid() = user_id` |
| Users can update their own sessions | UPDATE | `auth.uid() = user_id` |
| Users can delete their own sessions | DELETE | `auth.uid() = user_id` |
| Admins and staff can view all sessions | SELECT | `is_admin_or_staff(auth.uid())` |
| Admins and staff can delete all sessions | DELETE | `is_admin_or_staff(auth.uid())` |

---

## 10. Archive & Documents

### `archive_documents` - Historical Documents

**Sensitivity:** LOW (Public archive)

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Archive documents are viewable by everyone | SELECT | `true` (public) |
| Admins can manage archive documents | ALL | `is_admin_or_staff(auth.uid())` |

---

### `translations` - UI Translations

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Translations are viewable by everyone | SELECT | `true` (public) |
| Admins can manage translations | ALL | `is_admin_or_staff(auth.uid())` |

---

### `invitations` - User Invitations

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Admins can manage invitations | ALL | `is_admin_or_staff(auth.uid())` |
| Public can read active invitations | SELECT | Expiry + usage validation |
| Partners can view their own invitations | SELECT | `created_by = auth.uid()` |
| Partners can create invitations | INSERT | Partner status validation |
| Consultants can create invitations for their studies | INSERT | Study consultant validation |

---

## 11. Token System

### `token_config` - Token Configuration

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Token config viewable by everyone | SELECT | `true` (public) |
| Admins can manage token config | ALL | `is_admin_or_staff(auth.uid())` |

---

### `token_reward_rules` - Reward Rules

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Reward rules viewable by everyone | SELECT | `true` (public) |
| Admins can manage reward rules | ALL | `is_admin_or_staff(auth.uid())` |

---

### `token_locks` - Token Vesting/Locks

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Users can view their own locks | SELECT | `auth.uid() = user_id` |
| Admins can manage all locks | ALL | `is_admin_or_staff(auth.uid())` |

---

### `token_allocations` - Token Balances

| Policy | Operation | Access Rule |
|--------|-----------|-------------|
| Allocations viewable by everyone | SELECT | `true` (public - for transparency) |
| Admins can manage allocations | ALL | `is_admin_or_staff(auth.uid())` |

---

## 12. Security Best Practices Summary

### ✅ Implemented Security Controls

| Control | Status | Implementation |
|---------|--------|----------------|
| RLS on all tables | ✅ | Dynamic loop enables RLS on all public tables |
| User data isolation | ✅ | `auth.uid() = user_id` pattern throughout |
| sensitive data access control | ✅ | Consent-based access via `has_data_sharing_consent()` |
| Admin/Staff segregation | ✅ | `is_admin_or_staff()` helper function |
| Role-based permissions | ✅ | Dynamic `role_permissions` system |
| Audit trail | ✅ | `audit_journal` table with blockchain hash |
| No RLS bypass | ✅ | Only SECURITY DEFINER helper functions |
| Immutable audit records | ✅ | No UPDATE/DELETE policies on `audit_journal` |
| Consent tracking | ✅ | `consents` and `data_sharing_consents` tables |

### ⚠️ Security Recommendations

1. **Regular Policy Audit** - Review RLS policies quarterly
2. **Permission Cleanup** - Remove unused permissions from `role_permissions`
3. **Session Timeout** - Implement 30-minute sensitive data session timeout
4. **Break Glass Procedure** - Document emergency access procedures
5. **Consent Expiration** - Implement automatic consent expiration checks

### 📋 Compliance Checklist

| Requirement | compliance | security compliance | Status |
|-------------|-------|-------|--------|
| Access controls | Required | CC6.1 | ✅ |
| Audit logging | Required | CC7.2 | ✅ |
| Data encryption at rest | Required | CC6.7 | ✅ (Supabase) |
| Data encryption in transit | Required | CC6.7 | ✅ (TLS 1.2+) |
| Minimum necessary access | Required | CC6.1 | ✅ |
| User authentication | Required | CC6.1 | ✅ (Supabase Auth) |
| Change management | Required | CC8.1 | ✅ (Migrations) |

---

## Appendix A: Policy Naming Convention

Policies follow a consistent naming pattern:
- `"Users can [action] their own [resource]"` - User self-service
- `"Admins can [action] all [resource]"` - Admin access
- `"Consultants can view consented users [resource]"` - Consent-based sensitive data access
- `"[Resource] are viewable by everyone"` - Public access

---

## Appendix B: Migration References

Key migrations containing RLS policies:

| Migration | Purpose |
|-----------|---------|
| `00000000000000_baseline_v0.sql` | Base schema + RLS enable loop |
| `20251207212448_*.sql` | Core profiles, products, orders |
| `20251208072955_*.sql` | Memberships, studies, health tracking |
| `20251208073021_*.sql` | RBAC system + admin policies |
| `20251208161527_*.sql` | Partner profiles + appointments |
| `20251209180810_*.sql` | Data sharing consents |
| `20251211180035_*.sql` | Role permissions system |
| `20251212003202_*.sql` | Audit journal |
| `20251219012500_*.sql` | Dynamic permissions system |

---

## Appendix C: Critical Security Functions

### sensitive data Access Flow

```
User Request for sensitive data Data
         │
         ▼
┌─────────────────────────────────┐
│  Is auth.uid() = user_id?       │
│  (Own data access)              │
└─────────────────────────────────┘
         │ NO
         ▼
┌─────────────────────────────────┐
│  is_admin_or_staff(auth.uid())? │
│  (Admin/Staff override)         │
└─────────────────────────────────┘
         │ NO
         ▼
┌─────────────────────────────────┐
│  is_consultant_for_user()  AND  │
│  has_data_sharing_consent()?    │
│  (Consent-based access)         │
└─────────────────────────────────┘
         │ NO
         ▼
    ❌ ACCESS DENIED
```

---

*This document is maintained as part of the Platform security documentation. For updates, contact the security team.*
