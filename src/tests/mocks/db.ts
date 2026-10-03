import { vi } from 'vitest';

// Response type for createChainableMock
interface ChainableResponse<T = unknown> {
  data: T;
  error: { message: string; code?: string } | null;
}

// Chainable mock builder for Supabase query methods
export const createChainableMock = <T = unknown>(
  defaultResponse: ChainableResponse<T> = { data: null as T, error: null }
) => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'is', 'in', 'contains',
    'order', 'limit', 'range', 'single', 'maybeSingle',
    'match', 'not', 'filter', 'or', 'and', 'textSearch',
    'overlaps', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte',
    'rangeAdjacent',
  ];
  
  methods.forEach(method => {
    chain[method] = vi.fn().mockReturnValue(chain);
  });
  
  // Terminal methods that return promises
  chain.then = vi.fn((resolve) => resolve(defaultResponse));
  
  // Make the chain itself thenable
  Object.defineProperty(chain, 'then', {
    value: vi.fn((resolve) => Promise.resolve(defaultResponse).then(resolve)),
  });

  return chain;
};

// Create full Supabase client mock
export const createSupabaseMock = (overrides: Record<string, unknown> = {}) => {
  const authOverrides = (overrides.auth || {}) as Record<string, unknown>;
  const storageOverrides = (overrides.storage || {}) as Record<string, unknown>;
  
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ 
        data: { subscription: { unsubscribe: vi.fn() } } 
      }),
      ...authOverrides,
    },
    from: vi.fn().mockReturnValue(createChainableMock()),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: { path: 'mock-path' }, error: null }),
        download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://mock-url.com/file' } }),
        remove: vi.fn().mockResolvedValue({ data: [], error: null }),
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      ...storageOverrides,
    },
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    }),
    removeChannel: vi.fn(),
    ...overrides,
  };
};

// Pre-configured mock responses
export const mockResponses = {
  success: <T>(data: T) => ({ data, error: null }),
  error: (message: string) => ({ data: null, error: { message } }),
  empty: () => ({ data: [], error: null }),
  single: <T>(data: T) => ({ data, error: null }),
};

// Mock data factories
export const mockFactories = {
  user: (overrides = {}) => ({
    id: 'user-123',
    email: 'test@example.com',
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  profile: (overrides = {}) => ({
    id: 'profile-123',
    user_id: 'user-123',
    email: 'test@example.com',
    display_name: 'Test User',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }),
  
  product: (overrides = {}) => ({
    id: 'product-123',
    name: 'Test Product',
    description: 'Test description',
    price: 99.99,
    image_url: 'https://example.com/image.jpg',
    stock_quantity: 100,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  study: (overrides = {}) => ({
    id: 'study-123',
    code: 'TEST-001',
    name: 'Test Study',
    description: 'Test study description',
    status: 'active',
    is_umbrella: false,
    target_registration: 100,
    current_registration: 50,
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  registration: (overrides = {}) => ({
    id: 'registration-123',
    user_id: 'user-123',
    study_id: 'study-123',
    status: 'enrolled',
    enrolled_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  membership: (overrides = {}) => ({
    id: 'membership-123',
    user_id: 'user-123',
    tier: 'basic',
    status: 'active',
    starts_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  consent: (overrides = {}) => ({
    id: 'consent-123',
    user_id: 'user-123',
    consent_type: 'data_processing',
    granted: true,
    granted_at: new Date().toISOString(),
    version: '1.0',
    created_at: new Date().toISOString(),
    ...overrides,
  }),
  
  healthCheckIn: (overrides = {}) => ({
    id: 'checkin-123',
    user_id: 'user-123',
    check_in_date: new Date().toISOString().split('T')[0],
    check_in_type: 'daily',
    pain_level: 3,
    energy_level: 7,
    mood_level: 6,
    sleep_quality: 7,
    created_at: new Date().toISOString(),
    ...overrides,
  }),
};

// Default export
export default createSupabaseMock;
