import { useCallback, useEffect, useState } from 'react';

interface UseScrollRevealOptions {
    /** Viewport threshold (0-1) before triggering. Default: 0.15 */
    threshold?: number;
    /** Root margin for early/late triggering. Default: '0px 0px -40px 0px' */
    rootMargin?: string;
    /** Only trigger once. Default: true */
    once?: boolean;
}

/**
 * Intersection Observer hook for scroll-triggered reveal animations.
 * Uses a callback ref to correctly handle deferred DOM attachment
 * (e.g. when the element appears only after async data loading).
 *
 * Usage:
 * ```tsx
 * const { ref, isVisible } = useScrollReveal();
 * return <div ref={ref} className={isVisible ? 'reveal-visible' : 'reveal-hidden'}>...</div>
 * ```
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
    options: UseScrollRevealOptions = {}
) {
    const { threshold = 0.15, rootMargin = '0px 0px -40px 0px', once = true } = options;
    const [node, setNode] = useState<T | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    // Callback ref — React calls this whenever the DOM node is attached/detached.
    // Stable reference via useCallback prevents unnecessary re-attachments.
    const ref = useCallback((el: T | null) => {
        setNode(el);
    }, []);

    useEffect(() => {
        if (!node) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    if (once) observer.unobserve(node);
                } else if (!once) {
                    setIsVisible(false);
                }
            },
            { threshold, rootMargin }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [node, threshold, rootMargin, once]);

    return { ref, isVisible };
}

/**
 * Convenience wrapper that returns className strings for reveal animations.
 * Supports stagger delay index for grid children.
 *
 * Usage:
 * ```tsx
 * const { ref, className } = useRevealClass('fade-up');
 * return <div ref={ref} className={className}>...</div>
 * ```
 */
export function useRevealClass<T extends HTMLElement = HTMLDivElement>(
    variant: 'fade-up' | 'fade-in' | 'fade-scale' | 'slide-left' | 'slide-right' = 'fade-up',
    options: UseScrollRevealOptions = {}
) {
    const { ref, isVisible } = useScrollReveal<T>(options);

    const baseClass = `reveal-${variant}`;
    const className = isVisible ? `${baseClass} reveal-visible` : `${baseClass} reveal-hidden`;

    return { ref, isVisible, className };
}

/**
 * Returns a stagger delay style for use in grid children.
 * Apply to each child element in a grid/list with incrementing index.
 */
export function getStaggerDelay(index: number, baseMs: number = 80): React.CSSProperties {
    return { transitionDelay: `${index * baseMs}ms`, animationDelay: `${index * baseMs}ms` };
}
