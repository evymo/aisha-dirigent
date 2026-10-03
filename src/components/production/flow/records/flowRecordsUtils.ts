/**
 * Flow Records utility types, defaults and helpers.
 * @module flowRecordsUtils
 */

/** Form state for creating a new flow record. */
export interface FlowRecordForm {
  batch_id: string;
  concentration_pct: string;
  notes: string;
  source_node_id: string;
  substance_id: string;
  target_node_id: string;
  temperature_c: string;
  volume_l: string;
}

/** Empty defaults for the flow record form. */
export const defaultForm: FlowRecordForm = {
  batch_id: "",
  concentration_pct: "",
  notes: "",
  source_node_id: "",
  substance_id: "",
  target_node_id: "",
  temperature_c: "",
  volume_l: "",
};

/**
 * Trigger a CSV file download in the browser.
 *
 * @param csvContent - Raw CSV string
 * @param filenamePrefix - File name prefix (timestamp is appended)
 */
export function downloadCsvFile(csvContent: string, filenamePrefix: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
