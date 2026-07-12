import { describe, expect, it } from "vitest";
import { checkTranslation } from "./checks";

function checkFor(report: ReturnType<typeof checkTranslation>, kind: string) {
  const check = report.checks.find((c) => c.kind === kind);
  if (!check) throw new Error(`no check found for kind ${kind}`);
  return check;
}

describe("checkTranslation", () => {
  it("passes when all numbers, citations, and URLs survive verbatim", () => {
    const source = "Accuracy reached 87.4% (Smith, 2020), see https://example.com/paper for details.";
    const target = "ความแม่นยำถึง 87.4% (Smith, 2020) โปรดดู https://example.com/paper สำหรับรายละเอียด";
    const report = checkTranslation(source, target, 1);
    expect(report.passed).toBe(true);
    for (const check of report.checks) {
      expect(check.status).toBe("pass");
      expect(check.found).toBe(check.expected);
    }
    // "2020" inside the citation is also a distinct match for the numbers check.
    expect(checkFor(report, "numbers").expected).toBe(2);
    expect(checkFor(report, "citations").expected).toBe(1);
    expect(checkFor(report, "urls").expected).toBe(1);
  });

  it("flags a dropped number", () => {
    const source = "The sample included 87.4% of respondents.";
    const target = "ตัวอย่างรวมผู้ตอบแบบสอบถามจำนวนมาก";
    const report = checkTranslation(source, target, 2);
    expect(report.passed).toBe(false);
    const numbers = checkFor(report, "numbers");
    expect(numbers.status).toBe("warn");
    expect(numbers.missing).toContain("87.4%");
  });

  it("flags a dropped citation", () => {
    const source = "This finding replicates prior work (Smith, 2020).";
    const target = "ผลการค้นพบนี้สอดคล้องกับงานก่อนหน้า";
    const report = checkTranslation(source, target, 3);
    const citations = checkFor(report, "citations");
    expect(citations.status).toBe("warn");
    expect(citations.missing).toContain("(Smith, 2020)");
  });

  it("flags a dropped URL", () => {
    const source = "Full dataset at https://example.com/data.";
    const target = "ชุดข้อมูลฉบับเต็มอยู่ที่นี่";
    const report = checkTranslation(source, target, 4);
    const urls = checkFor(report, "urls");
    expect(urls.status).toBe("warn");
    expect(urls.missing).toContain("https://example.com/data.");
  });

  it("does not flag values that were never present in the source", () => {
    const source = "No numbers here.";
    const target = "ไม่มีตัวเลขที่นี่";
    const report = checkTranslation(source, target, 5);
    expect(report.passed).toBe(true);
  });

  it("deduplicates identical repeated occurrences of the same value", () => {
    const source = "It happened in 2020 and again in 2020 and once more in 2020 too";
    const target = "ไม่มีปีอยู่ในคำแปลนี้เลย";
    const report = checkTranslation(source, target, 6);
    const numbers = checkFor(report, "numbers");
    expect(numbers.missing).toEqual(["2020"]);
  });

  it("does not flag a number rendered as Thai numerals in the target", () => {
    const source = "The study was conducted in 2024 using survey methods.";
    const target = "การศึกษานี้ดำเนินการในปี ๒๐๒๔ โดยใช้แบบสำรวจ";
    const report = checkTranslation(source, target, 7);
    const numbers = checkFor(report, "numbers");
    expect(numbers.status).toBe("pass");
    expect(numbers.missing).toEqual([]);
    expect(numbers.found).toBe(1);
  });

  it("does not flag a number whose thousands separators were dropped in the target", () => {
    const source = "The city has 1,000,000 residents.";
    const target = "เมืองนี้มีประชากร 1000000 คน";
    const report = checkTranslation(source, target, 8);
    const numbers = checkFor(report, "numbers");
    expect(numbers.status).toBe("pass");
  });

  it("does not flag a number with both Thai numerals and no thousands separator", () => {
    const source = "The city has 10,000 residents.";
    const target = "เมืองนี้มีประชากร ๑๐๐๐๐ คน";
    const report = checkTranslation(source, target, 9);
    const numbers = checkFor(report, "numbers");
    expect(numbers.status).toBe("pass");
  });

  it("still flags a genuinely dropped number even with normalization applied", () => {
    const source = "Enrollment was 2024 students.";
    const target = "มีนักเรียนลงทะเบียนจำนวนมาก";
    const report = checkTranslation(source, target, 10);
    const numbers = checkFor(report, "numbers");
    expect(numbers.status).toBe("warn");
    expect(numbers.missing).toEqual(["2024"]);
    expect(numbers.found).toBe(0);
    expect(numbers.expected).toBe(1);
  });
});
