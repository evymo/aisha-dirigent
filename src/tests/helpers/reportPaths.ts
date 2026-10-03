import path from "path";

export function getReportDir(): string {
  return process.env.AISHA_REPORT_DIR
    ? path.resolve(process.env.AISHA_REPORT_DIR)
    : path.join(process.cwd(), "docs", "db-structure");
}

export function getReportPath(filename: string): string {
  return path.join(getReportDir(), filename);
}
