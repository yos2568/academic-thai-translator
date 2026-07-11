"use client";
import type { QaReport } from "@/lib/qa/checks";

export default function QaReportCard({ reports }: { reports: QaReport[] }) {
  if (!reports.length) return null;
  const warnings = reports.flatMap((report) => report.checks.filter((check) => check.status === "warn").map((check) => ({ chunk: report.chunk, ...check })));
  return <div className={`rounded-2xl border p-5 ${warnings.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
    <h2 className="font-semibold text-slate-800">{warnings.length ? `QA found ${warnings.length} item${warnings.length === 1 ? "" : "s"} to review` : "QA checks passed"}</h2>
    <p className="mt-1 text-sm text-slate-600">Numbers, citations, and URLs were compared with the source. Export remains available.</p>
    {warnings.length > 0 && <ul className="mt-3 space-y-1 text-sm text-amber-900">{warnings.map((warning, i) => <li key={`${warning.kind}-${i}`}>Section {warning.chunk} · {warning.label}: {warning.found}/{warning.expected} found — missing {warning.missing.join(", ")}</li>)}</ul>}
  </div>;
}
