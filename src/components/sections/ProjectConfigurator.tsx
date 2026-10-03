import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Calculator,
  Sparkles,
  TrendingDown,
  Bot,
  Users,
  Monitor,
  HardHat,
  Factory,
  Search,
  Pencil,
  Shield,
  ArrowRight,
  Zap,
  FileText,
  BrainCircuit,
  TrendingUp,
} from "lucide-react";
import {
  CONDUCTOR_DAY_RATE,
  BASE_AGENT_TOKEN_COST,
  VOLUME_DISCOUNT_MAX,
  HOURS_PER_MONTH,
  DEFAULT_HOURLY_RATE,
  DEFAULT_PROJECT_MONTHS,
  CONDUCTOR_DAYS_PER_ROLE,
  CONDUCTOR_DAYS_FACTOR,
  U_CURVE,
  PROJECT_SPLIT,
  MAINTENANCE_SPLIT,
  SPECIALIST_BLOCK_HOURS,
} from "@/lib/pricing-config";

interface UseCase {
  id: string;
  icon: React.ReactNode;
  agents: number;
  conductorDays: number;
  traditionalCost: number;
  operationCost: number;
  custom?: boolean;
}

const useCases: UseCase[] = [
  {
    id: "client-app",
    icon: <Monitor size={20} />,
    agents: 3,
    conductorDays: 5,
    traditionalCost: 350000,
    operationCost: 15000,
  },
  {
    id: "construction",
    icon: <HardHat size={20} />,
    agents: 5,
    conductorDays: 10,
    traditionalCost: 850000,
    operationCost: 25000,
  },
  {
    id: "manufacturing",
    icon: <Factory size={20} />,
    agents: 6,
    conductorDays: 15,
    traditionalCost: 1200000,
    operationCost: 35000,
  },
  {
    id: "analysis",
    icon: <Search size={20} />,
    agents: 4,
    conductorDays: 8,
    traditionalCost: 550000,
    operationCost: 20000,
  },
  {
    id: "custom",
    icon: <Pencil size={20} />,
    agents: 4,
    conductorDays: 0,
    traditionalCost: 500000,
    operationCost: 20000,
    custom: true,
  },
];

const ProjectConfigurator = () => {
  const { t, i18n } = useTranslation();
  const { formatPrice } = useCurrency();
  const [selectedId, setSelectedId] = useState("client-app");
  const [scalability, setScalability] = useState(50); // 0=conservative, 100=creative

  // Custom project state
  const [hasTeam, setHasTeam] = useState(true);
  // "Has team" mode
  const [teamSize, setTeamSize] = useState(5);
  const [hourlyRate, setHourlyRate] = useState(1500);
  const [projectMonths, setProjectMonths] = useState(4);
  // "No team" mode
  const [roleCount, setRoleCount] = useState(3);
  const [tier, setTier] = useState<"standard" | "premium">("standard");

  const selected = useCases.find((u) => u.id === selectedId)!;
  const isCustom = selectedId === "custom";

  // Agent count from tier: standard=1 agent/role, premium=2 agents/role
  const agentsPerRole = tier === "premium" ? 2 : 1;

  // Volume discount: more agents → lower per-agent token cost (up to 30%)
  const getVolumeDiscount = useCallback((totalAgents: number) => {
    // Linear ramp: 1 agent = 0%, 10+ agents = 30%
    return Math.min(VOLUME_DISCOUNT_MAX, (totalAgents - 1) * (VOLUME_DISCOUNT_MAX / 9));
  }, []);

  const getAgentOperationCost = useCallback((totalAgents: number) => {
    const discount = getVolumeDiscount(totalAgents);
    const perAgent = BASE_AGENT_TOKEN_COST * (1 - discount);
    return Math.round(totalAgents * perAgent);
  }, [getVolumeDiscount]);

  // Calculate custom costs dynamically
  const customCosts = useMemo(() => {
    if (hasTeam) {
      const traditional = teamSize * hourlyRate * HOURS_PER_MONTH * projectMonths;
      const conductorDays = Math.ceil(teamSize * projectMonths * CONDUCTOR_DAYS_FACTOR);
      const conductorCost = conductorDays * CONDUCTOR_DAY_RATE;
      const totalAgents = Math.max(teamSize, 2);
      const operationCost = getAgentOperationCost(totalAgents);
      const aisha = conductorCost + operationCost * projectMonths;
      const discount = getVolumeDiscount(totalAgents);
      return {
        traditional: Math.round(traditional),
        aisha: Math.round(aisha),
        conductorDays,
        conductorCost,
        operationCost,
        totalAgents,
        discount: Math.round(discount * 100),
      };
    } else {
      const totalAgents = roleCount * agentsPerRole;
      const conductorDays = Math.ceil(roleCount * CONDUCTOR_DAYS_PER_ROLE);
      const conductorCost = conductorDays * CONDUCTOR_DAY_RATE;
      const operationCost = getAgentOperationCost(totalAgents);
      const traditional = roleCount * DEFAULT_HOURLY_RATE * HOURS_PER_MONTH * DEFAULT_PROJECT_MONTHS;
      const aisha = conductorCost + operationCost * DEFAULT_PROJECT_MONTHS;
      const discount = getVolumeDiscount(totalAgents);
      return {
        traditional: Math.round(traditional),
        aisha: Math.round(aisha),
        conductorDays,
        conductorCost,
        operationCost,
        totalAgents,
        discount: Math.round(discount * 100),
      };
    }
  }, [hasTeam, teamSize, hourlyRate, projectMonths, roleCount, agentsPerRole, getAgentOperationCost, getVolumeDiscount]);

  const effectiveCosts = useMemo(() => isCustom
    ? {
      traditionalCost: customCosts.traditional,
      aishaCost: customCosts.aisha,
      operationCost: customCosts.operationCost,
      conductorDays: customCosts.conductorDays,
      conductorCost: customCosts.conductorCost,
      totalAgents: customCosts.totalAgents,
      discount: customCosts.discount,
    }
    : {
      traditionalCost: selected.traditionalCost,
      aishaCost: Math.round(selected.traditionalCost / 2),
      operationCost: selected.operationCost,
      conductorDays: selected.conductorDays,
      conductorCost: selected.conductorDays * CONDUCTOR_DAY_RATE,
      totalAgents: selected.agents,
      discount: Math.round(getVolumeDiscount(selected.agents) * 100),
    },
    [isCustom, customCosts, selected, getVolumeDiscount]);

  const results = useMemo(() => {
    // U-curve: both extremes benefit a lot, middle benefits least
    const normalized = scalability / 100;
    const uCurve = 1 - 4 * Math.pow(normalized - 0.5, 2);
    const capacityBoost = Math.round(U_CURVE.maxBoost - uCurve * U_CURVE.amplitude);

    const isConservative = scalability < U_CURVE.conservativeThreshold;
    const isCreative = scalability > U_CURVE.creativeThreshold;
    const needsTraining = scalability < U_CURVE.trainingThreshold;

    // U-curve affects real cost: boost reduces Evymo operational costs
    const effectiveBoost = capacityBoost / 100;
    const boostMultiplier = 1 - effectiveBoost * 0.3; // up to 22.5% reduction at poles
    const adjustedEvymo = Math.round(effectiveCosts.aishaCost * boostMultiplier);
    // Conservative teams: +10% onboarding cost (whole-company training)
    const onboardingExtra = isConservative ? Math.round(effectiveCosts.aishaCost * 0.1) : 0;
    const finalEvymo = adjustedEvymo + onboardingExtra;

    const savingPct = Math.round(
      ((effectiveCosts.traditionalCost - finalEvymo) / effectiveCosts.traditionalCost) * 100
    );

    return { savingPct, capacityBoost, isConservative, isCreative, needsTraining, finalEvymo, onboardingExtra };
  }, [effectiveCosts, scalability]);

  const formatCZK = (n: number) => formatPrice(n);

  return (
    <section className="py-28 bg-background relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gold/5 blur-[120px] rounded-full pointer-events-none opacity-40 translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gold/5 blur-[120px] rounded-full pointer-events-none opacity-30 -translate-x-1/4 translate-y-1/4" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 border border-gold/15 bg-gold/5 rounded-full mb-6">
            <Calculator className="text-gold/80" size={14} />
            <span className="text-gold/80 text-[10px] font-sans font-bold tracking-[0.2em] uppercase">
              {t("web.cfg.badge")}
            </span>
          </div>
          <h2 className="font-serif text-3xl md:text-[2.75rem] font-bold text-foreground mb-6 leading-tight">
            {t("web.cfg.title")}
          </h2>
          <p className="font-sans text-[15px] text-muted-foreground leading-relaxed">
            {t("web.cfg.subtitle")}
          </p>
        </motion.div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-12">
          {/* LEFT — Use Case Selector (3 cols) */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="lg:col-span-3 space-y-8"
          >
            {/* Use case cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {useCases.map((uc) => (
                <button
                  key={uc.id}
                  onClick={() => setSelectedId(uc.id)}
                  className={`group relative p-5 rounded-2xl border text-left transition-all duration-500 overflow-hidden ${selectedId === uc.id
                    ? "bg-card/80 border-gold/40 shadow-soft-xl shadow-gold/10 -translate-y-1"
                    : "bg-card/40 border-border/60 hover:border-gold/30 hover:bg-card/60 hover:-translate-y-0.5"
                    } backdrop-blur-sm`}
                >
                  {/* Subtle active state glow */}
                  <div className={`absolute inset-0 bg-gradient-to-br from-gold/10 to-transparent transition-opacity duration-500 ${selectedId === uc.id ? "opacity-100" : "opacity-0 group-hover:opacity-50"
                    }`} />

                  <div className="relative z-10">
                    <div
                      className={`mb-3 transition-colors duration-500 ${selectedId === uc.id ? "text-gold" : "text-muted-foreground group-hover:text-gold/70"
                        }`}
                    >
                      {uc.icon}
                    </div>
                    <h4
                      className={`font-sans text-[13px] font-bold tracking-wide transition-colors duration-500 ${selectedId === uc.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                        }`}
                    >
                      {t(`web.cfg.uc.${uc.id}.name`)}
                    </h4>
                  </div>
                </button>
              ))}
            </div>

            {/* Selected use case detail */}
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="relative rounded-2xl bg-card/60 backdrop-blur-md p-8 border border-border/60 shadow-soft-lg overflow-hidden group"
              >
                {/* Animated gradient top border */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-gold/40 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />

                <div className="flex items-start gap-4 mb-6 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
                    <span className="text-gold">{selected.icon}</span>
                  </div>
                  <div>
                    <h3 className="font-serif text-[22px] font-bold text-foreground">
                      {t(`web.cfg.uc.${selectedId}.name`)}
                    </h3>
                    <p className="font-sans text-[14px] text-muted-foreground mt-1.5 leading-relaxed">
                      {t(`web.cfg.uc.${selectedId}.desc`)}
                    </p>
                  </div>
                </div>

                {isCustom ? (
                  /* Custom project — team toggle + sliders */
                  <div className="space-y-6 mt-8 relative z-10">
                    {/* Toggle: Mám tým / Nemám tým */}
                    <div className="flex bg-secondary/50 p-1 rounded-xl">
                      <button
                        onClick={() => setHasTeam(true)}
                        className={`flex-1 py-3 px-4 rounded-lg font-sans text-[13px] font-bold tracking-wide uppercase transition-all duration-300 ${hasTeam
                          ? "bg-gold text-navy shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                          }`}
                      >
                        {t("web.cfg.custom.hasTeam")}
                      </button>
                      <button
                        onClick={() => setHasTeam(false)}
                        className={`flex-1 py-3 px-4 rounded-lg font-sans text-[13px] font-bold tracking-wide uppercase transition-all duration-300 ${!hasTeam
                          ? "bg-gold text-navy shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                          }`}
                      >
                        {t("web.cfg.custom.noTeam")}
                      </button>
                    </div>

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={hasTeam ? "has" : "no"}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-6"
                      >
                        {hasTeam ? (
                          <>
                            {/* Team size */}
                            <div className="bg-secondary/30 p-5 rounded-xl border border-border/50">
                              <div className="flex justify-between mb-4">
                                <label className="font-sans text-[13px] font-bold tracking-wide uppercase text-foreground/80">
                                  {t("web.cfg.custom.teamSize")}
                                </label>
                                <span className="font-sans text-[14px] font-bold text-gold bg-gold/10 px-3 py-1 rounded-full">
                                  {teamSize} {t("web.cfg.custom.people")}
                                </span>
                              </div>
                              <Slider value={[teamSize]} onValueChange={([v]) => setTeamSize(v)} min={1} max={15} step={1} className="w-full" />
                            </div>
                            {/* Hourly rate */}
                            <div className="bg-secondary/30 p-5 rounded-xl border border-border/50">
                              <div className="flex justify-between mb-4">
                                <label className="font-sans text-[13px] font-bold tracking-wide uppercase text-foreground/80">
                                  {t("web.cfg.custom.hourlyRate")}
                                </label>
                                <span className="font-sans text-[14px] font-bold text-gold bg-gold/10 px-3 py-1 rounded-full">
                                  {new Intl.NumberFormat(i18n.language).format(hourlyRate)} {t("web.cfg.custom.perHour")}
                                </span>
                              </div>
                              <Slider value={[hourlyRate]} onValueChange={([v]) => setHourlyRate(v)} min={500} max={3000} step={100} className="w-full" />
                            </div>
                            {/* Project duration */}
                            <div className="bg-secondary/30 p-5 rounded-xl border border-border/50">
                              <div className="flex justify-between mb-4">
                                <label className="font-sans text-[13px] font-bold tracking-wide uppercase text-foreground/80">
                                  {t("web.cfg.custom.projectMonths")}
                                </label>
                                <span className="font-sans text-[14px] font-bold text-gold bg-gold/10 px-3 py-1 rounded-full">
                                  {projectMonths} {t("web.cfg.custom.months")}
                                </span>
                              </div>
                              <Slider value={[projectMonths]} onValueChange={([v]) => setProjectMonths(v)} min={1} max={12} step={1} className="w-full" />
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Role count */}
                            <div className="bg-secondary/30 p-5 rounded-xl border border-border/50">
                              <div className="flex justify-between mb-4">
                                <label className="font-sans text-[13px] font-bold tracking-wide uppercase text-foreground/80">
                                  {t("web.cfg.custom.roleCount")}
                                </label>
                                <span className="font-sans text-[14px] font-bold text-gold bg-gold/10 px-3 py-1 rounded-full">
                                  {roleCount} {t("web.cfg.custom.roles")}
                                </span>
                              </div>
                              <Slider value={[roleCount]} onValueChange={([v]) => setRoleCount(v)} min={1} max={10} step={1} className="w-full" />
                              <p className="font-sans text-[12px] text-muted-foreground mt-3 flex items-center gap-2">
                                <Shield size={14} className="text-gold/60" />
                                {t("web.cfg.custom.roleHint")}
                              </p>
                            </div>

                            {/* Tier: Standard vs Premium */}
                            <div className="bg-secondary/30 p-5 rounded-xl border border-border/50">
                              <label className="font-sans text-[13px] font-bold tracking-wide uppercase text-foreground/80 mb-3 block">
                                {t("web.cfg.custom.tierLabel")}
                              </label>
                              <div className="grid grid-cols-2 gap-4">
                                <button
                                  onClick={() => setTier("standard")}
                                  className={`p-4 rounded-xl border text-left transition-all duration-300 ${tier === "standard"
                                    ? "bg-gold/10 border-gold/40 shadow-soft-md shadow-gold/5"
                                    : "bg-background/50 border-border/60 hover:border-gold/30 hover:bg-background/80"
                                    }`}
                                >
                                  <p className={`font-sans text-[15px] font-bold ${tier === "standard" ? "text-gold" : "text-foreground"}`}>
                                    Standard
                                  </p>
                                  <p className="font-sans text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
                                    {t("web.cfg.custom.tierStandard")}
                                  </p>
                                </button>
                                <button
                                  onClick={() => setTier("premium")}
                                  className={`p-4 rounded-xl border text-left transition-all duration-300 ${tier === "premium"
                                    ? "bg-gold/10 border-gold/40 shadow-soft-md shadow-gold/5"
                                    : "bg-background/50 border-border/60 hover:border-gold/30 hover:bg-background/80"
                                    }`}
                                >
                                  <p className={`font-sans text-[15px] font-bold ${tier === "premium" ? "text-gold" : "text-foreground"}`}>
                                    Premium
                                  </p>
                                  <p className="font-sans text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
                                    {t("web.cfg.custom.tierPremium")}
                                  </p>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </motion.div>
                    </AnimatePresence>

                    {/* Calculated costs summary */}
                    <div className="grid grid-cols-2 gap-5 pt-6 border-t border-border/40 mt-6">
                      <div className="rounded-xl bg-secondary/80 p-5 border border-border/40">
                        <span className="font-sans text-[11px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
                          {t("web.cfg.custom.traditional")}
                        </span>
                        <p className="font-sans text-[22px] font-bold text-foreground mt-2">
                          {formatCZK(customCosts.traditional)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gradient-to-br from-gold/10 to-transparent border border-gold/30 p-5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-gold/10 rounded-full blur-xl -mr-10 -mt-10" />
                        <span className="relative z-10 font-sans text-[11px] font-bold tracking-[0.1em] text-gold uppercase">
                          {t("web.cfg.custom.withEvymo")}
                        </span>
                        <p className="relative z-10 font-sans text-[22px] font-bold text-gold mt-2">
                          {formatCZK(customCosts.aisha)}
                        </p>
                        <p className="relative z-10 font-sans text-[11px] text-muted-foreground mt-2 flex flex-wrap gap-x-2 gap-y-1">
                          <span>{customCosts.totalAgents} {t("web.cfg.agents.suffix")}</span>
                          <span className="text-border/80">•</span>
                          <span>{t("web.cfg.conductor.breakdown")}: {customCosts.conductorDays} × {formatCZK(CONDUCTOR_DAY_RATE)}</span>
                        </p>
                        {customCosts.discount > 0 && (
                          <div className="relative z-10 mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gold/20 text-gold text-[10px] font-bold">
                            <TrendingDown size={10} strokeWidth={2.5} />
                            {t("web.cfg.custom.volumeDiscount")}: -{customCosts.discount}% {t("web.cfg.custom.onTokens")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard use cases — before/after + agents info */
                  <div className="relative z-10">
                    {/* Before / After blocks */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-8">
                      <div className="rounded-xl bg-secondary/80 p-5 border border-border/40">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-6 h-6 rounded-md bg-background flex items-center justify-center">
                            <FileText className="text-muted-foreground" size={12} />
                          </span>
                          <span className="font-sans text-[11px] font-bold text-muted-foreground tracking-[0.15em] uppercase">
                            {t("web.cfg.old.label")}
                          </span>
                        </div>
                        <p className="font-sans text-[14px] text-muted-foreground leading-relaxed">
                          {t(`web.cfg.uc.${selectedId}.old`)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-gradient-to-br from-gold/10 to-transparent border border-gold/30 p-5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-gold/10 rounded-full blur-xl -mr-10 -mt-10" />
                        <div className="relative z-10 flex items-center gap-2 mb-3">
                          <span className="w-6 h-6 rounded-md bg-gold/20 flex items-center justify-center">
                            <BrainCircuit className="text-gold" size={12} />
                          </span>
                          <span className="font-sans text-[11px] font-bold text-gold tracking-[0.15em] uppercase">
                            {t("web.cfg.new.label")}
                          </span>
                        </div>
                        <p className="relative z-10 font-sans text-[14px] text-foreground leading-relaxed">
                          {t(`web.cfg.uc.${selectedId}.new`)}
                        </p>
                      </div>
                    </div>

                    {/* Agents & Conductor info */}
                    <div className="grid grid-cols-2 gap-5 mt-5">
                      <div className="rounded-xl bg-secondary/50 p-5 border border-border/40 flex flex-col justify-center">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-6 h-6 rounded-md bg-background flex items-center justify-center">
                            <Bot className="text-gold" size={12} />
                          </span>
                          <span className="font-sans text-[11px] font-bold text-muted-foreground tracking-[0.15em] uppercase">
                            {t("web.cfg.agents.label")}
                          </span>
                        </div>
                        <p className="font-sans text-[28px] font-bold text-foreground">
                          {selected.agents}
                          <span className="text-[14px] font-normal text-muted-foreground ml-2">
                            {t("web.cfg.agents.suffix")}
                          </span>
                        </p>
                      </div>
                      <div className="rounded-xl bg-secondary/50 p-5 border border-border/40">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-6 h-6 rounded-md bg-background flex items-center justify-center">
                            <Users className="text-gold" size={12} />
                          </span>
                          <span className="font-sans text-[11px] font-bold text-muted-foreground tracking-[0.15em] uppercase">
                            {t("web.cfg.conductor.label")}
                          </span>
                        </div>
                        <p className="font-sans text-[18px] font-bold text-foreground">
                          {selected.conductorDays} {t("web.cfg.conductor.days")}
                        </p>
                        <p className="font-sans text-[13px] text-muted-foreground mt-1">
                          = {formatCZK(selected.conductorDays * CONDUCTOR_DAY_RATE)}
                        </p>
                        <p className="font-sans text-[11px] text-muted-foreground/60 mt-1">
                          {t("web.cfg.conductor.rate")}
                        </p>
                      </div>
                    </div>

                    {/* What's included */}
                    <div className="mt-8 pt-5 border-t border-border/40">
                      <h4 className="font-sans text-[11px] font-bold text-muted-foreground tracking-[0.1em] uppercase mb-4">
                        {t("web.cfg.included.title")}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {["monitoring", "escalation", "updates", "kb"].map((item) => (
                          <div key={item} className="flex items-center gap-3">
                            <span className="w-5 h-5 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
                              <Shield className="text-gold" size={10} />
                            </span>
                            <span className="font-sans text-[13px] text-muted-foreground">
                              {t(`web.cfg.included.${item}`)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Team readiness slider */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 lg:p-8 mt-6">
              <div className="flex justify-between items-center mb-2">
                <label className="font-sans text-[15px] font-bold text-foreground tracking-wide">
                  {t("web.cfg.scale.title")}
                </label>
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gold/10 border border-gold/20">
                  <TrendingUp className="text-gold" size={14} />
                  <span className="font-sans text-[13px] font-bold text-gold">
                    +{results.capacityBoost}% {t("web.cfg.scale.capacity")}
                  </span>
                </div>
              </div>
              <p className="font-sans text-[14px] text-muted-foreground mb-6 leading-relaxed">
                {t("web.cfg.scale.desc")}
              </p>

              <div className="px-2">
                <Slider
                  value={[scalability]}
                  onValueChange={([v]) => setScalability(v)}
                  min={0}
                  max={100}
                  step={5}
                  className="w-full py-4"
                />
              </div>

              <div className="flex justify-between mt-3 px-1">
                <span className={`font-sans text-[12px] transition-colors duration-300 ${results.isConservative ? "text-gold font-bold" : "text-muted-foreground/60"}`}>
                  {t("web.cfg.scale.conservative")}
                </span>
                <span className={`font-sans text-[12px] transition-colors duration-300 ${!results.isConservative && !results.isCreative ? "text-foreground/80 font-bold" : "text-muted-foreground/40"}`}>
                  {t("web.cfg.scale.middle")}
                </span>
                <span className={`font-sans text-[12px] transition-colors duration-300 ${results.isCreative ? "text-gold font-bold" : "text-muted-foreground/60"}`}>
                  {t("web.cfg.scale.creative")}
                </span>
              </div>

              {/* Dynamic adoption insight */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={results.isConservative ? "cons" : results.isCreative ? "crea" : "mid"}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="mt-6 pt-5 border-t border-border/40"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${results.isConservative ? "bg-gold/20" : results.isCreative ? "bg-gold/20" : "bg-card border border-border"
                      }`}>
                      {results.isConservative ? (
                        <Shield className="text-gold" size={16} />
                      ) : results.isCreative ? (
                        <Sparkles className="text-gold" size={16} />
                      ) : (
                        <Users className="text-muted-foreground" size={16} />
                      )}
                    </div>
                    <div>
                      <p className="font-sans text-[14px] font-bold text-foreground mb-1">
                        {results.isConservative
                          ? t("web.cfg.scale.insight.cons.title")
                          : results.isCreative
                            ? t("web.cfg.scale.insight.crea.title")
                            : t("web.cfg.scale.insight.mid.title")}
                      </p>
                      <p className="font-sans text-[13px] text-muted-foreground leading-relaxed">
                        {results.isConservative
                          ? t("web.cfg.scale.insight.cons.desc")
                          : results.isCreative
                            ? t("web.cfg.scale.insight.crea.desc")
                            : t("web.cfg.scale.insight.mid.desc")}
                      </p>
                    </div>
                  </div>

                  {results.needsTraining && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl bg-gradient-to-r from-gold/10 to-transparent border border-gold/20"
                    >
                      <BrainCircuit className="text-gold shrink-0" size={14} />
                      <span className="font-sans text-[13px] font-medium text-gold/90">
                        {t("web.cfg.scale.training")}
                      </span>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>

          {/* RIGHT — Results (2 cols) */}
          {/* RIGHT — Results (2 cols) */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="lg:col-span-2 space-y-6"
          >
            {/* Traditional */}
            <div className="rounded-2xl border border-destructive/20 bg-card/40 backdrop-blur-sm p-6 lg:p-8 transition-all duration-300 hover:bg-card/60">
              <h3 className="font-serif text-[18px] font-bold text-foreground mb-2">
                {t("web.cfg.result.traditionalTitle")}
              </h3>
              <p className="font-sans text-[13px] text-muted-foreground mb-4 leading-relaxed">
                {t("web.cfg.result.traditionalDesc")}
              </p>
              <p className="font-sans text-[32px] font-bold text-foreground tracking-tight">
                {formatCZK(effectiveCosts.traditionalCost)}
              </p>
              <div className="mt-5 w-full h-1.5 rounded-full bg-destructive/10 overflow-hidden">
                <div className="w-full h-full bg-destructive/40 rounded-full" />
              </div>
            </div>

            {/* With Evymo */}
            <div className="rounded-2xl border-2 border-gold/30 bg-gradient-to-br from-gold/5 via-card/80 to-card/40 backdrop-blur-md p-6 lg:p-8 relative shadow-soft-xl shadow-gold/5 group overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-t from-gold/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

              <div className="absolute -top-3 right-5 px-3.5 py-1.5 bg-gradient-to-r from-gold to-gold-light text-navy text-[10px] font-sans font-bold tracking-[0.2em] uppercase rounded-full flex items-center gap-1.5 shadow-md">
                <TrendingDown size={14} strokeWidth={2.5} />
                {t("web.cfg.result.saving")} {results.savingPct}%
              </div>

              <div className="relative z-10">
                <h3 className="font-serif text-[18px] font-bold text-foreground mb-2">
                  {t("web.cfg.result.withEvymoTitle")}
                </h3>
                <p className="font-sans text-[13px] text-muted-foreground mb-4 leading-relaxed">
                  {t("web.cfg.result.withEvymoDesc")}
                </p>
                <div className="flex items-end gap-2">
                  <p className="font-sans text-[36px] font-bold text-gold tracking-tighter leading-none">
                    {formatCZK(results.finalEvymo)}
                  </p>
                  <span className="text-[13px] font-medium text-muted-foreground mb-1">
                    {t("web.cfg.result.onetime")}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-2 text-[12px] font-sans text-muted-foreground/80 bg-background/50 py-2 px-3 rounded-lg w-fit">
                  <Users size={14} className="text-gold/70" />
                  <span>
                    {t("web.cfg.conductor.breakdown")}: {effectiveCosts.conductorDays} × {formatCZK(CONDUCTOR_DAY_RATE)} = {formatCZK(effectiveCosts.conductorCost)}
                  </span>
                </div>
                {results.onboardingExtra > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-[12px] font-sans text-gold/70 bg-gold/5 py-2 px-3 rounded-lg w-fit">
                    <BrainCircuit size={14} />
                    <span>{t("web.cfg.result.onboarding")}: +{formatCZK(results.onboardingExtra)}</span>
                  </div>
                )}
                <div className="mt-5 w-full h-1.5 rounded-full bg-gold/10 overflow-hidden relative">
                  <motion.div
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-gold/60 to-gold rounded-full"
                    initial={{ width: "100%" }}
                    animate={{ width: `${100 - results.savingPct}%` }}
                    transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>

            {/* Operations */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm p-6 lg:p-8 space-y-4">
              <h4 className="font-sans text-[11px] font-bold text-muted-foreground uppercase tracking-[0.1em]">
                {t("web.cfg.ops.title")}
              </h4>
              <div className="flex justify-between items-end pb-4 border-b border-border/40">
                <span className="text-[13px] text-muted-foreground font-medium">
                  {effectiveCosts.totalAgents} {t("web.cfg.agents.suffix")} · {t("web.cfg.ops.operation")}
                </span>
                <span className="font-sans text-[16px] font-bold text-foreground">
                  {t("web.cfg.ops.from")} {formatCZK(effectiveCosts.operationCost)}<span className="text-[13px] text-muted-foreground font-normal">/{t("web.cfg.ops.month")}</span>
                </span>
              </div>

              {effectiveCosts.discount > 0 && (
                <div className="flex justify-end">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-sans font-semibold text-gold bg-gold/10 px-2 py-1 rounded-full">
                    <TrendingDown size={12} strokeWidth={2.5} />
                    <span>{t("web.cfg.custom.volumeDiscount")}: -{effectiveCosts.discount}% {t("web.cfg.custom.onTokens")}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                {["monitoring", "escalation", "updates"].map((item) => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-gold/10 flex items-center justify-center shrink-0">
                      <Zap className="text-gold" size={10} />
                    </div>
                    <span className="font-sans text-[13px] text-muted-foreground">
                      {t(`web.cfg.ops.inc.${item}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Premium */}
            <div className="rounded-xl border border-gold/20 bg-gradient-to-r from-gold/10 to-transparent p-5 lg:p-6 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gold/10 blur-[40px] rounded-full group-hover:scale-150 transition-transform duration-700" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center shrink-0">
                    <Sparkles className="text-gold" size={14} />
                  </div>
                  <h4 className="font-sans text-[15px] font-bold text-gold tracking-wide">
                    {t("web.cfg.premium.title")}
                  </h4>
                </div>
                <p className="font-sans text-[13px] text-muted-foreground leading-relaxed pl-11">
                  {t("web.cfg.premium.desc")}
                </p>
              </div>
            </div>

            {/* Tagline & Disclaimer */}
            <div className="pt-6 text-center space-y-4">
              <p className="font-serif text-[15px] italic text-gold flex items-center justify-center gap-3 relative inline-block mx-auto">
                <span className="w-8 h-px bg-gradient-to-r from-transparent to-gold/40" />
                <ArrowRight size={16} className="text-gold/60" />
                <span className="px-2">{t("web.cfg.tagline")}</span>
                <span className="w-8 h-px bg-gradient-to-l from-transparent to-gold/40" />
              </p>
              <p className="font-sans text-[11px] text-muted-foreground/60 italic max-w-sm mx-auto leading-relaxed">
                {t("web.cfg.disclaimer")}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Marketplace Bridge — Revenue Transparency + Guild CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-5xl mx-auto mt-24"
        >
          <div className="rounded-2xl border border-gold/20 bg-gradient-to-br from-card/80 via-gold/5 to-card/80 backdrop-blur-md p-8 lg:p-12 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
            <div className="absolute -top-20 -right-20 w-60 h-60 bg-gold/5 rounded-full blur-[60px] pointer-events-none" />

            <div className="relative z-10">
              <div className="text-center mb-10">
                <h3 className="font-serif text-2xl md:text-3xl font-bold text-foreground mb-3">
                  {t("web.cfg.guild.title")}
                </h3>
                <p className="font-sans text-[15px] text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                  {t("web.cfg.guild.subtitle")}
                </p>
              </div>

              {/* Revenue Split Transparency */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                {/* Project split */}
                <div className="rounded-xl bg-card/60 border border-border/50 p-6">
                  <h4 className="font-sans text-[13px] font-bold tracking-[0.1em] uppercase text-foreground/80 mb-4">
                    {t("web.cfg.guild.projectSplit")}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[14px] text-muted-foreground">{t("web.cfg.guild.specialist")}</span>
                      <span className="font-sans text-[16px] font-bold text-gold">{PROJECT_SPLIT.specialist * 100}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-secondary/50 overflow-hidden">
                      <div className="h-full rounded-full bg-gold/60" style={{ width: `${PROJECT_SPLIT.specialist * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[14px] text-muted-foreground">{t("web.cfg.guild.knowledge")}</span>
                      <span className="font-sans text-[14px] font-bold text-foreground/70">{PROJECT_SPLIT.knowledge * 100}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[14px] text-muted-foreground">{t("web.cfg.guild.platform")}</span>
                      <span className="font-sans text-[14px] font-bold text-foreground/70">{PROJECT_SPLIT.platform * 100}%</span>
                    </div>
                  </div>
                </div>

                {/* Maintenance split */}
                <div className="rounded-xl bg-card/60 border border-border/50 p-6">
                  <h4 className="font-sans text-[13px] font-bold tracking-[0.1em] uppercase text-foreground/80 mb-4">
                    {t("web.cfg.guild.maintenanceSplit")}
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[14px] text-muted-foreground">{t("web.cfg.guild.platform")}</span>
                      <span className="font-sans text-[16px] font-bold text-gold">{MAINTENANCE_SPLIT.platform * 100}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-secondary/50 overflow-hidden">
                      <div className="h-full rounded-full bg-gold/60" style={{ width: `${MAINTENANCE_SPLIT.platform * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[14px] text-muted-foreground">{t("web.cfg.guild.knowledge")}</span>
                      <span className="font-sans text-[14px] font-bold text-foreground/70">{MAINTENANCE_SPLIT.knowledge * 100}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[14px] text-muted-foreground">{t("web.cfg.guild.specialist")}</span>
                      <span className="font-sans text-[14px] font-bold text-foreground/70">{MAINTENANCE_SPLIT.specialist * 100}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Pricing anchor + CTA */}
              <div className="text-center space-y-4">
                <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-gold/10 border border-gold/20">
                  <Users size={16} className="text-gold" />
                  <span className="font-sans text-[14px] font-medium text-foreground">
                    {t("web.cfg.guild.blockRate", {
                      rate: new Intl.NumberFormat(i18n.language).format(CONDUCTOR_DAY_RATE),
                      hours: SPECIALIST_BLOCK_HOURS,
                    })}
                  </span>
                </div>
                <div>
                  <Link
                    to="/guild"
                    className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-gold to-gold-light text-navy font-sans text-[14px] font-bold tracking-wide rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
                  >
                    {t("web.cfg.guild.cta")}
                    <ArrowRight size={16} />
                  </Link>
                </div>
                <p className="font-sans text-[12px] text-muted-foreground/60 max-w-md mx-auto">
                  {t("web.cfg.guild.ctaHint")}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default ProjectConfigurator;
