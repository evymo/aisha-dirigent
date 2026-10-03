import type { DosingInputValue } from "./DosingInput";

export const defaultDosingInputValue: DosingInputValue = {
  tookRtnProducts: false,
  selectedProtocolId: null,
  isCustomDistribution: false,
  customDoseAmount: null,
  customDoseUnit: "drops",
  customDosesPerDay: null,
  customDoseTiming: [],
  notes: "",
  reportType: "daily",
};
