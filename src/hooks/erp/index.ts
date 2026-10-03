/**
 * @fileoverview ERP hooks barrel — re-exports all production ERP admin hooks and schemas
 */

// Schemas & types
export {
  parseRpcArraySafe,
  productionBatchMaterialSchema,
  productionCapaSchema,
  productionDeviationSchema,
  productionEquipmentCalibrationSchema,
  productionEquipmentCleaningSchema,
  productionEquipmentSchema,
  productionInventoryEventSchema,
  productionLocationSchema,
  productionLotSchema,
  productionQcTestDefinitionSchema,
  productionReleaseDecisionSchema,
  productionSensorReadingSchema,
  productionSupplierSchema,
  type ProductionBatchMaterial,
  type ProductionCapa,
  type ProductionDeviation,
  type ProductionEquipment,
  type ProductionEquipmentCalibration,
  type ProductionEquipmentCleaning,
  type ProductionInventoryEvent,
  type ProductionLocation,
  type ProductionLot,
  type ProductionQcTestDefinition,
  type ProductionReleaseDecision,
  type ProductionSensorReading,
  type ProductionSupplier,
} from "./erpSchemas";

// Master data hooks (suppliers, locations, equipment)
export {
  useProductionEquipmentAdmin,
  useProductionLocationsAdmin,
  useProductionSuppliersAdmin,
  useUpsertProductionEquipmentMutation,
  useUpsertProductionLocationMutation,
  useUpsertProductionSupplierMutation,
} from "./useProductionMasterDataAdmin";

// Inventory hooks (lots, inventory events, batch materials)
export {
  useCreateProductionInventoryEventMutation,
  useProductionBatchMaterialsAdmin,
  useProductionInventoryEventsAdmin,
  useProductionLotsAdmin,
  useUpsertProductionBatchMaterialMutation,
  useUpsertProductionLotMutation,
} from "./useProductionInventoryAdmin";

// Quality hooks (deviations, CAPA, release decisions)
export {
  useCreateProductionReleaseDecisionMutation,
  useProductionCapaAdmin,
  useProductionDeviationsAdmin,
  useProductionReleaseDecisionsAdmin,
  useUpsertProductionCapaMutation,
  useUpsertProductionDeviationMutation,
} from "./useProductionQualityAdmin";

// Maintenance hooks (calibrations, cleaning, QC test defs, sensor readings)
export {
  useCreateProductionEquipmentCalibrationMutation,
  useCreateProductionEquipmentCleaningMutation,
  useCreateProductionSensorReadingMutation,
  useProductionEquipmentCalibrationsAdmin,
  useProductionEquipmentCleaningAdmin,
  useProductionQcTestDefinitionsAdmin,
  useProductionSensorReadingsAdmin,
  useUpsertProductionQcTestDefinitionMutation,
} from "./useProductionMaintenanceAdmin";
