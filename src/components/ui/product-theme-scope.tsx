import React from 'react';
import { cn } from '@/lib/utils';

export type ProductTheme = 'floristen' | 'lyastin' | 'retisin' | 'silexil' | 'default';

interface ProductThemeScopeProps extends React.HTMLAttributes<HTMLDivElement> {
    product?: ProductTheme;
    children: React.ReactNode;
}

/**
 * ProductThemeScope
 * 
 * Wraps content in a specific product's theme context.
 * It dynamically overrides CSS variables for --primary, --ring, etc.
 * to match the product's identity.
 */
export function ProductThemeScope({
    product = 'default',
    className,
    children,
    ...props
}: ProductThemeScopeProps) {

    // Mapping of product themes to their CSS variable overrides
    // We use the style attribute to scope these variables to this container
    const themeStyles = React.useMemo(() => {
        if (product === 'default') return {};

        return {
            '--primary': `var(--md-color-${product}-primary)`,
            '--ring': `var(--md-color-${product}-primary)`,
            // We can also override accent/secondary if needed
            // '--accent': `var(--md-color-${product}-glass)`,
        } as React.CSSProperties;
    }, [product]);

    return (
        <div
            className={cn(
                'product-theme-scope transition-colors duration-500',
                product !== 'default' && `theme-${product}`,
                className
            )}
            style={themeStyles}
            {...props}
        >
            {/* Background Ambient Glow (Optional - can be disabled via className if needed) */}
            {product !== 'default' && (
                <div
                    className="pointer-events-none absolute inset-0 -z-10 opacity-20 transition-opacity duration-1000"
                    style={{
                        background: `radial-gradient(circle at 50% 30%, hsl(var(--md-color-${product}-glow)) 0%, transparent 60%)`
                    }}
                />
            )}

            {children}
        </div>
    );
}
