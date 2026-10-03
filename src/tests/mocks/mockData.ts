// Common mock data for tests
import { mockFactories } from './db';

// Pre-created mock entities
export const mockUser = mockFactories.user();
export const mockProfile = mockFactories.profile();
export const mockProduct = mockFactories.product();
export const mockStudy = mockFactories.study();
export const mockRegistration = mockFactories.registration();
export const mockMembership = mockFactories.membership();
export const mockConsent = mockFactories.consent();
export const mockTrackingCheckIn = mockFactories.healthCheckIn();

// Collections
export const mockProducts = [
  mockFactories.product({ id: 'prod-1', name: 'Retisin', price: 1499 }),
  mockFactories.product({ id: 'prod-2', name: 'Lyastin', price: 1299 }),
  mockFactories.product({ id: 'prod-3', name: 'Floristen', price: 999 }),
];

export const mockStudies = [
  mockFactories.study({ id: 'study-umbrella', code: 'AISHA-OBS-001', name: 'AISHA Community', is_umbrella: true }),
  mockFactories.study({ id: 'study-oa', code: 'RII-OA-001', name: 'Osteoarthritis Study' }),
  mockFactories.study({ id: 'study-ms', code: 'RII-MS-001', name: 'Metabolic Syndrome Study' }),
];

export const mockRoles = [
  { id: 'role-1', user_id: mockUser.id, role: 'member', created_at: new Date().toISOString() },
];

export const mockPartnerRoles = [
  { id: 'role-2', user_id: mockUser.id, role: 'partner', created_at: new Date().toISOString() },
];

export const mockAdminRoles = [
  { id: 'role-3', user_id: mockUser.id, role: 'admin', created_at: new Date().toISOString() },
];

// Test questions (legacy - not currently imported anywhere but kept for reference)
export const mockTestQuestions = [
  {
    id: 'q1',
    test_type: 'qualification',
    question_key: 'qualification.q1.question',
    option_a_key: 'qualification.q1.option_a',
    option_b_key: 'qualification.q1.option_b',
    option_c_key: 'qualification.q1.option_c',
    correct_answer: 'b',
    order_index: 1,
  },
  {
    id: 'q2',
    test_type: 'qualification',
    question_key: 'qualification.q2.question',
    option_a_key: 'qualification.q2.option_a',
    option_b_key: 'qualification.q2.option_b',
    option_c_key: 'qualification.q2.option_c',
    correct_answer: 'c',
    order_index: 2,
  },
];

// Subscription packages
export const mockSubscriptionPackages = [
  {
    id: 'pkg-1',
    name: 'Basic',
    description: 'Basic membership',
    price: 499,
    currency: 'CZK',
    duration_months: 1,
    is_active: true,
    features: ['Basic access'],
  },
  {
    id: 'pkg-2',
    name: 'Premium',
    description: 'Premium membership',
    price: 999,
    currency: 'CZK',
    duration_months: 6,
    is_active: true,
    features: ['Full access', 'Priority support'],
  },
];

// Cart items
export const mockCartItems = [
  {
    id: 'cart-1',
    user_id: mockUser.id,
    product_id: 'prod-1',
    quantity: 2,
    product: mockProducts[0],
  },
];

// Orders
export const mockOrders = [
  {
    id: 'order-1',
    user_id: mockUser.id,
    status: 'delivered',
    total: 2998,
    created_at: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
  },
];

// Tracking check-ins
export const mockTrackingCheckIns = [
  mockFactories.healthCheckIn({ id: 'checkin-1', pain_level: 3 }),
  mockFactories.healthCheckIn({ id: 'checkin-2', pain_level: 2, check_in_date: '2024-01-02' }),
  mockFactories.healthCheckIn({ id: 'checkin-3', pain_level: 1, check_in_date: '2024-01-03' }),
];

// Tokens
export const mockTokenBalance = {
  user_id: mockUser.id,
  tokens_data: 100,
  tokens_governance: 50,
  tokens_impact: 25,
};

// Notifications
export const mockNotifications = [
  {
    id: 'notif-1',
    user_id: mockUser.id,
    type: 'order_shipped',
    title: 'Order Shipped',
    message: 'Your order has been shipped',
    is_read: false,
    created_at: new Date().toISOString(),
  },
];

// Partner profiles
export const mockPartnerProfile = {
  id: 'partner-1',
  user_id: mockUser.id,
  display_name: 'Dr. Test',
  city: 'Prague',
  country: 'CZ',
  is_visible: true,
  is_production_provider: true,
  certification_level: 'certified',
};

// Archive documents
export const mockArchiveDocuments = [
  {
    id: 'doc-1',
    slug: 'historical-paper-1947',
    title: 'Historical Paper 1947',
    document_type: 'research_paper',
    year: 1947,
    provenance_badge: 'original_scan',
  },
];

export default {
  mockUser,
  mockProfile,
  mockProduct,
  mockStudy,
  mockRegistration,
  mockMembership,
  mockConsent,
  mockTrackingCheckIn,
  mockProducts,
  mockStudies,
  mockRoles,
  mockTestQuestions,
  mockSubscriptionPackages,
  mockCartItems,
  mockOrders,
  mockTrackingCheckIns,
  mockTokenBalance,
  mockNotifications,
  mockPartnerProfile,
  mockArchiveDocuments,
};
