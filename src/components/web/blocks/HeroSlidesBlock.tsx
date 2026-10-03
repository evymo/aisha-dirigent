/**
 * HeroSlidesBlock — Runtime block wrapper for the HeroSlider.
 *
 * Renders the full HeroSlider component (with useHeroSlides data,
 * parallax, auto-advance, and linked product actions) inside a
 * GrapesJS canvas page.
 *
 * Editor placeholder: `<div data-runtime-block="hero-slides"></div>`
 *
 * @module
 */

import { HeroSlider } from "@/components/landing/HeroSlider";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Runtime block that renders the hero slides carousel.
 * Data is fetched internally via useHeroSlides hook.
 */
export default function HeroSlidesBlock(_props: RuntimeBlockProps) {
  return <HeroSlider />;
}
