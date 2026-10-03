import { useDocumentTitle } from "@/hooks/use-document-title";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  Brain, Monitor, Server, ShieldCheck, Cloud,
  Users, ArrowRight, RotateCcw, CheckCircle2, AlertTriangle, Wrench, UserCheck,
  Zap, CalendarOff, TrendingUp, FileX, CircleDollarSign,
  Search, MessageSquare, Bot, Package,
  BookOpen, Code2, TestTube2, Rocket,
  Database, Share2, Layers, ShieldPlus,
} from "lucide-react";
import ProjectConfigurator from "@/components/sections/ProjectConfigurator";
import MaintenanceSection from "@/components/sections/MaintenanceSection";

const SolutionPage = () => {
  const { t } = useTranslation();
  useDocumentTitle(t("web.solution.hero.title"));

  const roles = [
    { icon: Brain, titleKey: "web.solution.role.analyst.title", subtitleKey: "web.solution.role.analyst.subtitle", descKey: "web.solution.role.analyst.desc", costKey: "web.solution.role.analyst.cost", isHuman: true },
    { icon: Monitor, titleKey: "web.solution.role.frontend.title", subtitleKey: "web.solution.role.frontend.subtitle", descKey: "web.solution.role.frontend.desc", costKey: "web.solution.role.ai.cost", isHuman: false },
    { icon: Server, titleKey: "web.solution.role.backend.title", subtitleKey: "web.solution.role.backend.subtitle", descKey: "web.solution.role.backend.desc", costKey: "web.solution.role.ai.cost", isHuman: false },
    { icon: ShieldCheck, titleKey: "web.solution.role.qa.title", subtitleKey: "web.solution.role.qa.subtitle", descKey: "web.solution.role.qa.desc", costKey: "web.solution.role.ai.cost", isHuman: false },
    { icon: Cloud, titleKey: "web.solution.role.devops.title", subtitleKey: "web.solution.role.devops.subtitle", descKey: "web.solution.role.devops.desc", costKey: "web.solution.role.ai.cost", isHuman: false },
  ];

  const selfCorrectionSteps = [
    { icon: Bot, key: "web.solution.selfcorrect.step1" },
    { icon: AlertTriangle, key: "web.solution.selfcorrect.step2" },
    { icon: Wrench, key: "web.solution.selfcorrect.step3" },
    { icon: UserCheck, key: "web.solution.selfcorrect.step4" },
  ];

  const traditionalTeam = [
    { key: "web.solution.cost.traditional.pm.label", costKey: "web.solution.cost.traditional.pm.cost" },
    { key: "web.solution.cost.traditional.fe.label", costKey: "web.solution.cost.traditional.fe.cost" },
    { key: "web.solution.cost.traditional.be.label", costKey: "web.solution.cost.traditional.be.cost" },
    { key: "web.solution.cost.traditional.qa.label", costKey: "web.solution.cost.traditional.qa.cost" },
    { key: "web.solution.cost.traditional.devops.label", costKey: "web.solution.cost.traditional.devops.cost" },
  ];

  const agenticTeam = [
    { key: "web.solution.cost.agentic.analyst.label", costKey: "web.solution.cost.agentic.analyst.cost" },
    { key: "web.solution.cost.agentic.agents.label", costKey: "web.solution.cost.agentic.agents.cost" },
  ];

  const paradigmPoints = [
    { icon: Zap, key: "web.solution.paradigm.point1" },
    { icon: FileX, key: "web.solution.paradigm.point2" },
    { icon: CalendarOff, key: "web.solution.paradigm.point3" },
    { icon: TrendingUp, key: "web.solution.paradigm.point4" },
    { icon: CircleDollarSign, key: "web.solution.paradigm.point5" },
  ];

  const workflowSteps = [
    { icon: Search, key: "step1" },
    { icon: MessageSquare, key: "step2" },
    { icon: Bot, key: "step3" },
    { icon: Package, key: "step4" },
  ];

  const rulesItems = [
    { icon: BookOpen, key: "web.rules.rule.arch" },
    { icon: Code2, key: "web.rules.rule.code" },
    { icon: TestTube2, key: "web.rules.rule.test" },
    { icon: Rocket, key: "web.rules.rule.deploy" },
  ];

  const caseStudies = ["case1"] as const;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-18">
        {/* Hero — Guerrilla manifesto */}
        <section className="py-24 md:py-32 bg-primary text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.05]">
            <div className="absolute inset-0" style={{
              backgroundImage: `linear-gradient(hsl(var(--accent) / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--accent) / 0.3) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }} />
          </div>
          <div className="container mx-auto px-6 relative z-10">
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className="max-w-4xl mx-auto">
              <span className="inline-block px-4 py-1.5 bg-accent/10 border border-accent/20 rounded-full text-accent text-xs font-sans font-medium tracking-widest uppercase mb-8">
                {t("web.solution.hero.badge")}
              </span>
              <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold text-primary-foreground mb-6 leading-[1.1]">
                {t("web.solution.hero.title")}
              </h1>
              <p className="text-accent font-serif text-xl md:text-2xl font-medium italic mb-6">
                {t("web.solution.hero.subtitle")}
              </p>
              <p className="font-sans text-primary-foreground/50 text-base md:text-lg leading-relaxed max-w-3xl mx-auto">
                {t("web.solution.hero.manifesto")}
              </p>
            </motion.div>
          </div>
        </section>

        {/* === ROLES SECTION === */}
        <section className="py-20 md:py-28 bg-background">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.solution.roles.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.solution.roles.subtitle")}</p>
            </motion.div>

            {/* Analyst card */}
            <motion.div initial={{ opacity: 0, y: 25 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="max-w-2xl mx-auto mb-12">
              <div className="relative rounded-2xl border-2 border-gold/30 bg-card p-8 text-center shadow-lg">
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gold text-navy text-xs font-sans font-bold tracking-widest uppercase rounded-full">
                  {t("web.solution.roles.humanBadge")}
                </div>
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gold/10 border-2 border-gold/30 flex items-center justify-center">
                  <Brain className="text-gold" size={36} />
                </div>
                <h3 className="font-serif text-2xl font-bold text-foreground">{t(roles[0].titleKey)}</h3>
                <p className="text-gold font-sans text-sm font-medium mt-1 mb-3">{t(roles[0].subtitleKey)}</p>
                <p className="font-sans text-muted-foreground text-sm leading-relaxed mb-4">{t(roles[0].descKey)}</p>
                <div className="inline-block px-4 py-2 bg-gold/10 rounded-full">
                  <span className="text-gold font-sans font-bold text-lg">{t(roles[0].costKey)}</span>
                </div>
              </div>
            </motion.div>

            {/* Connecting arrows */}
            <div className="flex justify-center mb-8">
              <div className="flex flex-col items-center gap-1">
                <div className="w-px h-8 bg-gold/30" />
                <div className="text-gold/40 text-xs font-sans font-medium tracking-widest uppercase">{t("web.solution.roles.orchestrates")}</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-16 h-px bg-gold/20" />
                  <ArrowRight className="text-gold/40" size={14} />
                  <div className="w-16 h-px bg-gold/20" />
                </div>
              </div>
            </div>

            {/* AI Agent cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
              {roles.slice(1).map((role, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 25 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="relative rounded-xl border border-border bg-card p-6 text-center hover:border-gold/30 transition-colors"
                >
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-primary text-accent text-[10px] font-sans font-bold tracking-widest uppercase rounded-full border border-accent/20">
                    {t("web.solution.roles.agentBadge")}
                  </div>
                  <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-primary/80 flex items-center justify-center">
                    <role.icon className="text-accent" size={24} />
                  </div>
                  <h3 className="font-serif text-lg font-semibold text-foreground">{t(role.titleKey)}</h3>
                  <p className="text-gold/70 font-sans text-xs font-medium mt-0.5 mb-2">{t(role.subtitleKey)}</p>
                  <p className="font-sans text-muted-foreground text-xs leading-relaxed mb-3">{t(role.descKey)}</p>
                  <div className="text-gold/60 font-sans text-xs font-medium">{t(role.costKey)}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* === SELF-CORRECTION === */}
        <section className="py-20 bg-secondary">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.solution.selfcorrect.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.solution.selfcorrect.subtitle")}</p>
            </motion.div>
            <div className="max-w-3xl mx-auto">
              <div className="relative">
                <div className="absolute left-6 top-0 bottom-0 w-px bg-gold/20 hidden md:block" />
                {selfCorrectionSteps.map((step, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }} className="flex items-start gap-4 mb-6 last:mb-0">
                    <div className="w-12 h-12 shrink-0 rounded-full bg-card border border-gold/20 flex items-center justify-center relative z-10">
                      <step.icon className="text-gold" size={20} />
                    </div>
                    <div className="pt-2.5">
                      <p className="font-sans text-foreground font-medium">{t(step.key)}</p>
                    </div>
                  </motion.div>
                ))}
                <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.7 }} className="flex items-center gap-3 mt-6 ml-16 md:ml-16">
                  <RotateCcw className="text-gold/50" size={18} />
                  <p className="font-sans text-gold/70 text-sm italic">{t("web.solution.selfcorrect.loop")}</p>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* === SHARED KNOWLEDGE BASE === */}
        <section className="py-20 md:py-28 bg-background">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.solution.kb.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.solution.kb.subtitle")}</p>
            </motion.div>

            <div className="max-w-5xl mx-auto">
              {/* Flow: Experts → KB → Agents → Output */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                {/* Contributors */}
                <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="rounded-2xl border border-gold/20 bg-card p-6">
                  <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center mb-4">
                    <Users className="text-gold" size={24} />
                  </div>
                  <h3 className="font-serif text-lg font-bold text-foreground mb-2">{t("web.solution.kb.contribute.title")}</h3>
                  <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-4">{t("web.solution.kb.contribute.desc")}</p>
                  <div className="space-y-2">
                    {["dirigent", "consultant", "client"].map((role) => (
                      <div key={role} className="flex items-center gap-2">
                        <Share2 className="text-gold/50" size={12} />
                        <span className="font-sans text-xs text-muted-foreground">{t(`web.solution.kb.contribute.${role}`)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Knowledge Base center */}
                <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.15 }} className="rounded-2xl border-2 border-gold/30 bg-gold/5 p-6 flex flex-col items-center text-center relative">
                  <div className="absolute -top-3 px-3 py-1 bg-gold text-navy text-xs font-sans font-bold tracking-widest uppercase rounded-full">
                    {t("web.solution.kb.label")}
                  </div>
                  <div className="w-16 h-16 rounded-full bg-gold/10 border-2 border-gold/30 flex items-center justify-center mb-4 mt-2">
                    <Database className="text-gold" size={28} />
                  </div>
                  <h3 className="font-serif text-lg font-bold text-foreground mb-2">{t("web.solution.kb.core.title")}</h3>
                  <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-4">{t("web.solution.kb.core.desc")}</p>
                  <div className="space-y-2 w-full">
                    {["rules", "patterns", "domain", "feedback"].map((item) => (
                      <div key={item} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border/50">
                        <Layers className="text-gold/60 shrink-0" size={14} />
                        <span className="font-sans text-xs font-medium text-foreground">{t(`web.solution.kb.core.${item}`)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Beneficiaries */}
                <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }} className="rounded-2xl border border-gold/20 bg-card p-6">
                  <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center mb-4">
                    <ShieldPlus className="text-gold" size={24} />
                  </div>
                  <h3 className="font-serif text-lg font-bold text-foreground mb-2">{t("web.solution.kb.benefit.title")}</h3>
                  <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-4">{t("web.solution.kb.benefit.desc")}</p>
                  <div className="space-y-2">
                    {["agents", "experts", "clients"].map((who) => (
                      <div key={who} className="flex items-center gap-2">
                        <CheckCircle2 className="text-gold/50" size={12} />
                        <span className="font-sans text-xs text-muted-foreground">{t(`web.solution.kb.benefit.${who}`)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>

              {/* Bottom callout */}
              <motion.div initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.4 }} className="rounded-xl bg-secondary border border-border p-6 text-center max-w-2xl mx-auto">
                <p className="font-sans text-sm text-muted-foreground leading-relaxed">
                  {t("web.solution.kb.callout")}
                </p>
              </motion.div>
            </div>
          </div>
        </section>

        {/* === COLLABORATIVE RULES DEFINITION === */}
        <section className="py-20 md:py-28 bg-background">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.rules.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.rules.subtitle")}</p>
            </motion.div>

            <div className="max-w-4xl mx-auto">
              {/* Circular collaboration diagram */}
              <div className="relative flex flex-col md:flex-row items-center justify-center gap-8 md:gap-4">
                {/* Three actors around center */}
                {[
                  { key: "web.rules.actor.client", descKey: "web.rules.actor.client.desc", icon: Users },
                  { key: "web.rules.actor.analyst", descKey: "web.rules.actor.analyst.desc", icon: Brain },
                  { key: "web.rules.actor.agents", descKey: "web.rules.actor.agents.desc", icon: Bot },
                ].map((actor, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.15 }}
                    className="flex-1 rounded-xl border border-border bg-card p-6 text-center"
                  >
                    <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gold/10 flex items-center justify-center">
                      <actor.icon className="text-gold" size={24} />
                    </div>
                    <h3 className="font-serif text-lg font-bold text-foreground mb-1">{t(actor.key)}</h3>
                    <p className="font-sans text-xs text-muted-foreground">{t(actor.descKey)}</p>
                  </motion.div>
                ))}
              </div>

              {/* Arrows converging to center */}
              <div className="flex justify-center my-6">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-px bg-gold/20" />
                  <div className="px-4 py-2 rounded-full bg-gold/10 border border-gold/20">
                    <span className="text-gold font-sans text-sm font-bold">{t("web.rules.center")}</span>
                  </div>
                  <div className="w-16 h-px bg-gold/20" />
                </div>
              </div>

              {/* Rules items */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
                {rulesItems.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.08 }}
                    className="flex items-center gap-2 px-4 py-3 rounded-lg bg-secondary border border-border"
                  >
                    <item.icon className="text-gold shrink-0" size={16} />
                    <span className="font-sans text-xs font-medium text-foreground">{t(item.key)}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* === COST BREAKDOWN INFOGRAPHIC === */}
        <section className="py-20 md:py-28 bg-secondary">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.solution.cost.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.solution.cost.subtitle")}</p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {/* Traditional team */}
              <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="rounded-2xl border border-destructive/20 bg-card p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Users className="text-destructive/70" size={24} />
                  <h3 className="font-serif text-xl font-bold text-foreground">{t("web.solution.cost.traditional.title")}</h3>
                </div>
                <div className="space-y-3">
                  {traditionalTeam.map((member, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                      <span className="font-sans text-sm text-muted-foreground">{t(member.key)}</span>
                      <span className="font-sans text-sm font-medium text-foreground">{t(member.costKey)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-4 border-t-2 border-destructive/20 flex justify-between items-center">
                  <span className="font-sans text-sm font-bold text-foreground">{t("web.solution.cost.traditional.total")}</span>
                  <div className="w-32 h-3 rounded-full bg-destructive/20 overflow-hidden">
                    <div className="w-full h-full bg-destructive/50 rounded-full" />
                  </div>
                </div>
              </motion.div>

              {/* Agentic team */}
              <motion.div initial={{ opacity: 0, x: 20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="rounded-2xl border-2 border-gold/30 bg-card p-8 relative">
                <div className="absolute -top-3 right-6 px-3 py-1 bg-gold text-navy text-xs font-sans font-bold tracking-widest uppercase rounded-full">
                  {t("web.solution.cost.saving.badge")}
                </div>
                <div className="flex items-center gap-3 mb-6">
                  <Bot className="text-gold" size={24} />
                  <h3 className="font-serif text-xl font-bold text-foreground">{t("web.solution.cost.agentic.title")}</h3>
                </div>
                <div className="space-y-3">
                  {agenticTeam.map((member, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                      <span className="font-sans text-sm text-muted-foreground">{t(member.key)}</span>
                      <span className="font-sans text-sm font-medium text-gold">{t(member.costKey)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 pt-4 border-t-2 border-gold/30 flex justify-between items-center">
                  <span className="font-sans text-sm font-bold text-foreground">{t("web.solution.cost.agentic.total")}</span>
                  <div className="w-32 h-3 rounded-full bg-gold/10 overflow-hidden">
                    <div className="w-[54%] h-full bg-gold/50 rounded-full" />
                  </div>
                </div>
                <p className="mt-4 font-sans text-xs text-muted-foreground italic">{t("web.solution.cost.agentic.note")}</p>
              </motion.div>
            </div>

            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="max-w-2xl mx-auto mt-10 text-center">
              <p className="font-sans text-muted-foreground text-sm leading-relaxed">{t("web.solution.cost.saving.desc")}</p>
            </motion.div>
          </div>
        </section>

        {/* === MANIFESTO HOOK — before configurator === */}
        <section className="py-20 md:py-28 bg-primary text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]">
            <div className="absolute inset-0" style={{
              backgroundImage: `radial-gradient(circle at 30% 50%, hsl(var(--accent) / 0.15) 0%, transparent 50%), radial-gradient(circle at 70% 50%, hsl(var(--accent) / 0.1) 0%, transparent 50%)`,
            }} />
          </div>
          <div className="container mx-auto px-6 relative z-10">
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="max-w-3xl mx-auto">
              <p className="font-serif text-2xl md:text-3xl lg:text-4xl text-primary-foreground/70 leading-snug mb-4">
                {t("web.manifesto.hook.line1")}
              </p>
              <p className="font-serif text-xl md:text-2xl text-primary-foreground/50 leading-snug mb-10">
                {t("web.manifesto.hook.line2")}
              </p>
              <motion.p
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4, duration: 0.5 }}
                className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold text-accent"
              >
                {t("web.manifesto.hook.punchline")}
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* === PROJECT CONFIGURATOR === */}
        <ProjectConfigurator />

        {/* === TRANSFORMATION NARRATIVE — after configurator === */}
        <section className="py-20 md:py-28 bg-background">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="max-w-3xl mx-auto text-center space-y-8">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground">
                {t("web.manifesto.transform.title")}
              </h2>
              <div className="space-y-5 text-left">
                <p className="font-sans text-muted-foreground leading-relaxed text-lg">
                  {t("web.manifesto.transform.p1")}
                </p>
                <p className="font-sans text-muted-foreground leading-relaxed text-lg">
                  {t("web.manifesto.transform.p2")}
                </p>
                <p className="font-sans text-foreground leading-relaxed text-lg font-medium">
                  {t("web.manifesto.transform.p3")}
                </p>
              </div>
              <div className="pt-6 border-t border-border">
                <blockquote className="font-serif text-2xl md:text-3xl text-gold italic font-bold mb-3">
                  {"\u201C"}{t("web.manifesto.transform.philosophy")}{"\u201D"}
                </blockquote>
                <p className="font-sans text-sm text-muted-foreground">
                  {t("web.manifesto.transform.signature")}
                </p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* === MAINTENANCE & OPERATIONS === */}
        <MaintenanceSection />

        {/* === WHY NOW / CASE STUDIES === */}
        <section className="py-20 md:py-28 bg-primary relative overflow-hidden">
          <div className="absolute top-1/4 -left-40 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
          <div className="container mx-auto px-6 relative z-10">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-primary-foreground mb-4">{t("web.trends.title")}</h2>
              <p className="font-sans text-primary-foreground/50 leading-relaxed">{t("web.trends.subtitle")}</p>
            </motion.div>

            {caseStudies.map((cs, idx) => (
              <motion.div
                key={cs}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.2 }}
                className="max-w-4xl mx-auto mb-10"
              >
                {/* Badge */}
                <div className="mb-6 text-center">
                  <span className="inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider bg-accent/20 text-accent rounded-full">
                    {t(`web.trends.${cs}.badge`)}
                  </span>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  {(["files", "loc", "tests", "commits"] as const).map((metric, i) => (
                    <motion.div
                      key={metric}
                      initial={{ opacity: 0, y: 15 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.1 * i }}
                      className="text-center py-5 px-3 rounded-xl bg-primary-foreground/5 border border-primary-foreground/10"
                    >
                      <p className="font-sans text-3xl md:text-4xl font-bold text-accent">{t(`web.trends.${cs}.${metric}`)}</p>
                      <p className="font-sans text-primary-foreground/40 text-xs mt-1">{t(`web.trends.${cs}.${metric}Label`)}</p>
                    </motion.div>
                  ))}
                </div>

                {/* Scope + description */}
                <div className="max-w-3xl mx-auto rounded-2xl bg-primary-foreground/5 border border-primary-foreground/10 p-8 mb-8">
                  <h3 className="font-serif text-xl md:text-2xl font-bold text-primary-foreground mb-3">{t(`web.trends.${cs}.scope`)}</h3>
                  <p className="font-sans text-primary-foreground/50 text-sm leading-relaxed mb-5">{t(`web.trends.${cs}.detail`)}</p>
                  <p className="font-sans text-primary-foreground/30 text-xs leading-relaxed">{t(`web.trends.${cs}.highlights`)}</p>
                </div>

                {/* Time comparison + cost badges */}
                <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                  {/* Period with AISHA */}
                  <div className="rounded-2xl border-2 border-accent/30 bg-primary-foreground/5 p-6 text-center">
                    <p className="font-sans text-3xl md:text-4xl font-bold text-accent">{t(`web.trends.${cs}.period`)}</p>
                    <p className="font-sans text-primary-foreground/40 text-xs mt-2">{t(`web.trends.${cs}.periodLabel`)}</p>
                  </div>
                  {/* Traditional */}
                  <div className="rounded-2xl bg-primary-foreground/5 border border-primary-foreground/10 p-6 text-center">
                    <p className="font-sans text-3xl md:text-4xl font-bold text-primary-foreground/30 line-through">{t(`web.trends.${cs}.traditional`)}</p>
                    <p className="font-sans text-primary-foreground/30 text-xs mt-2">{t(`web.trends.${cs}.traditionalLabel`)}</p>
                  </div>
                  {/* Cost saved */}
                  <div className="rounded-2xl bg-primary-foreground/5 border border-primary-foreground/10 p-6 text-center">
                    <p className="font-sans text-3xl md:text-4xl font-bold text-accent">{t(`web.trends.${cs}.costSaved`)}</p>
                    <p className="font-sans text-primary-foreground/40 text-xs mt-2">{t(`web.trends.${cs}.costSavedLabel`)}</p>
                  </div>
                </div>

                {/* Acceleration badges */}
                <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-6 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-4xl md:text-5xl font-bold text-accent">{t(`web.trends.${cs}.acceleration`)}</span>
                    <span className="font-sans text-primary-foreground/40 text-sm">{t(`web.trends.${cs}.accelerationLabel`)}</span>
                  </div>
                  <ArrowRight className="text-accent/30 hidden sm:block" size={20} />
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-4xl md:text-5xl font-bold text-accent">{t(`web.trends.${cs}.saving`)}</span>
                    <span className="font-sans text-primary-foreground/40 text-sm">{t(`web.trends.${cs}.savingLabel`)}</span>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Bottom line */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-3xl mx-auto text-center mt-10"
            >
              <p className="font-sans text-primary-foreground/30 text-xs mb-6">{t("web.trends.moreComingSoon")}</p>
              <p className="font-serif text-xl md:text-2xl font-bold text-accent italic">{t("web.trends.bottom")}</p>
            </motion.div>
          </div>
        </section>

        {/* === PARADIGM SHIFT === */}
        <section className="py-20 md:py-28 bg-background">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.solution.paradigm.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.solution.paradigm.desc")}</p>
            </motion.div>

            <div className="max-w-2xl mx-auto space-y-4">
              {paradigmPoints.map((point, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-4 py-3 px-5 rounded-xl bg-secondary border border-border"
                >
                  <point.icon className="text-gold shrink-0" size={20} />
                  <p className="font-sans text-foreground text-sm font-medium">{t(point.key)}</p>
                  <CheckCircle2 className="text-gold/40 ml-auto shrink-0" size={16} />
                </motion.div>
              ))}
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.6 }}
              className="text-center mt-12 font-serif text-2xl md:text-3xl text-gold font-bold italic"
            >
              {t("web.solution.paradigm.cta")}
            </motion.p>
          </div>
        </section>

        {/* === WORKFLOW === */}
        <section className="py-20 bg-secondary">
          <div className="container mx-auto px-6 max-w-4xl">
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="font-serif text-3xl md:text-4xl font-bold text-foreground text-center mb-14">
              {t("web.solution.workflow.title")}
            </motion.h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
              <div className="hidden md:block absolute top-12 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-gold/20 via-gold/40 to-gold/20" />
              {workflowSteps.map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.15 * i }}
                  className="text-center relative"
                >
                  <div className="w-24 h-24 mx-auto mb-5 rounded-full bg-primary flex items-center justify-center relative z-10 border-2 border-accent/20">
                    <step.icon className="text-accent" size={32} />
                  </div>
                  <h3 className="font-serif text-xl font-semibold text-foreground mb-2">{t(`web.solution.workflow.${step.key}.title`)}</h3>
                  <p className="font-sans text-sm text-muted-foreground leading-relaxed">{t(`web.solution.workflow.${step.key}.desc`)}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default SolutionPage;
