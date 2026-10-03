import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import HeroSection from "@/components/sections/HeroSection";
import TrustBar from "@/components/sections/TrustBar";
import ProjectConfigurator from "@/components/sections/ProjectConfigurator";
import PillarsSection from "@/components/sections/PillarsSection";
import HowItWorksSection from "@/components/sections/HowItWorksSection";
import AboutSection from "@/components/sections/AboutSection";
import SpecialistGuildSection from "@/components/sections/SpecialistGuildSection";
import HiringSection from "@/components/sections/HiringSection";
import CTASection from "@/components/sections/CTASection";

const Index = () => {
  const { t } = useTranslation();
  useDocumentTitle(t("web.hero.title"));

  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <HeroSection />
        <TrustBar />
        <PillarsSection />
        <HowItWorksSection />
        <AboutSection />
        <SpecialistGuildSection />
        <ProjectConfigurator />
        <HiringSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
