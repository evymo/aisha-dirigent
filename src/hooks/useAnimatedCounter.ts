import { useEffect, useRef, useState, useCallback } from 'react';

interface UseAnimatedCounterOptions {
    /** Final target value */
    target: number;
    /** Animation duration in ms. Default: 1500 */
    duration?: number;
    /** Only trigger once on viewport entry. Default: true */
    once?: boolean;
    /** Viewport threshold. Default: 0.3 */
    threshold?: number;
    /** Number of decimal places. Default: 0 */
    decimals?: number;
}

/**
 * Animated counter that counts up from 0 to target when scrolled into view.
 * Uses requestAnimationFrame for smooth 60fps animation with ease-out easing.
 *
 * Usage:
 * ```tsx
 * const { ref, value } = useAnimatedCounter({ target: 1250 });
 * return <span ref={ref}>{value.toLocaleString()}</span>
 * ```
 */
export function useAnimatedCounter({
    target,
    duration = 1500,
    once = true,
    threshold = 0.3,
    decimals = 0,
}: UseAnimatedCounterOptions) {
    const ref = useRef<HTMLElement>(null);
    const [value, setValue] = useState(0);
    const [hasAnimated, setHasAnimated] = useState(false);

    const animate = useCallback(() => {
        if (hasAnimated && once) return;

        const startTime = performance.now();
        const startValue = 0;

        function tick(currentTime: number) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease-out cubic for natural deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = startValue + (target - startValue) * eased;

            setValue(Number(current.toFixed(decimals)));

            if (progress < 1) {
                requestAnimationFrame(tick);
            } else {
                setValue(target);
                setHasAnimated(true);
            }
        }

        requestAnimationFrame(tick);
    }, [target, duration, once, hasAnimated, decimals]);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && (!hasAnimated || !once)) {
                    animate();
                }
            },
            { threshold }
        );

        observer.observe(element);
        return () => observer.disconnect();
    }, [threshold, animate, hasAnimated, once]);

    return { ref, value, hasAnimated };
}
