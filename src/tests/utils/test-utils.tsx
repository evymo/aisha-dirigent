import React, { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, renderHook as rtlRenderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

// Create a test query client with optimized settings
export const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0,
      staleTime: 0,
    },
    mutations: {
      retry: false,
    },
  },
});

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
  queryClient?: QueryClient;
  useMemoryRouter?: boolean;
}

// All providers wrapper
const AllProviders = ({ 
  children, 
  queryClient,
  initialEntries,
  useMemoryRouter = true,
}: { 
  children: ReactNode;
  queryClient: QueryClient;
  initialEntries?: string[];
  useMemoryRouter?: boolean;
}) => {
  const Router = useMemoryRouter ? MemoryRouter : BrowserRouter;
  const routerProps = useMemoryRouter && initialEntries ? { initialEntries } : {};

  return (
    <QueryClientProvider client={queryClient}>
      <Router {...routerProps}>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </Router>
    </QueryClientProvider>
  );
};

// Custom render function with all providers
export const customRender = (
  ui: ReactElement,
  options: CustomRenderOptions = {}
) => {
  const { 
    initialEntries = ['/'], 
    queryClient = createTestQueryClient(),
    useMemoryRouter = true,
    ...renderOptions 
  } = options;

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders 
      queryClient={queryClient} 
      initialEntries={initialEntries}
      useMemoryRouter={useMemoryRouter}
    >
      {children}
    </AllProviders>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
  };
};

// Re-export everything from testing-library
export * from '@testing-library/react';
export { customRender as render };
export { customRender as renderWithProviders }; // Alias for component tests

// Hook rendering with providers
export { renderHook } from '@testing-library/react';

// Custom hook render with query client
export const renderHookWithProviders = <TProps, TResult>(
  hook: (props: TProps) => TResult,
  options: CustomRenderOptions & { initialProps?: TProps } = {}
) => {
  const { 
    initialEntries = ['/'], 
    queryClient = createTestQueryClient(),
    useMemoryRouter = true,
    initialProps,
    ...renderOptions 
  } = options;

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders 
      queryClient={queryClient} 
      initialEntries={initialEntries}
      useMemoryRouter={useMemoryRouter}
    >
      {children}
    </AllProviders>
  );

  return {
    ...rtlRenderHook(hook, { 
      wrapper: Wrapper, 
      initialProps,
      ...renderOptions 
    }),
    queryClient,
  };
};

// Mock user event setup
export { default as userEvent } from '@testing-library/user-event';

// Helper to wait for loading states
export const waitForLoadingToFinish = () => 
  new Promise(resolve => setTimeout(resolve, 0));

// Helper to create mock user
export const createMockUser = (overrides = {}) => ({
  id: 'test-user-id',
  email: 'test@example.com',
  created_at: new Date().toISOString(),
  ...overrides,
});

// Helper to create mock session
export const createMockSession = (overrides = {}) => ({
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: createMockUser(),
  ...overrides,
});
