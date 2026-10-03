import { QueryClient } from "@tanstack/react-query";
import { DEFAULT_QUERY_OPTIONS } from "./queryDefaults";

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            ...DEFAULT_QUERY_OPTIONS,
        },
    },
});
