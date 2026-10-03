import path from "node:path";

export function resolveReportOutput(rootDir, filename) {
  const reportDir = process.env.AISHA_REPORT_DIR
    ? path.resolve(process.env.AISHA_REPORT_DIR)
    : path.join(rootDir, "docs", "db-structure");

  return {
    reportDir,
    reportPath: path.join(reportDir, filename),
  };
}
