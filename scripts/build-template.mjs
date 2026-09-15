import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "outputs", "jeopardy-template");
const previewDir = path.join(projectRoot, ".template-preview");
const workbook = Workbook.create();
const instructions = workbook.worksheets.add("Instructions");
const questions = workbook.worksheets.add("Questions");
const final = workbook.worksheets.add("Final Jeopardy");
const font = "Arial";
const colors = { navy: "#081F67", blue: "#1244C6", gold: "#F8C64C", ink: "#17213D", muted: "#5E6B8A", input: "#FFF3C4", white: "#FFFFFF", line: "#D7DFF2" };

for (const sheet of [instructions, questions, final]) {
  sheet.showGridLines = false;
  sheet.getRange("A1:F40").format.font = { name: font, size: 10, color: colors.ink };
}

instructions.getRange("A1:D1").merge();
instructions.getRange("A1").values = [["Classroom Jeopardy import template"]];
instructions.getRange("A1").format.font = { name: font, size: 18, bold: true, color: colors.navy };
instructions.getRange("A2:D2").merge();
instructions.getRange("A2").values = [["Complete the Questions and Final Jeopardy sheets, then upload this workbook in the teacher dashboard."]];
instructions.getRange("A2").format.font = { name: font, size: 10, italic: true, color: colors.muted };
instructions.getRange("A4:B9").values = [
  ["Step", "What to do"],
  [1, "Rename Category 1–6. Use the same category name on all five rows."],
  [2, "Write one clue and answer for each value: 100, 200, 300, 400, and 500."],
  [3, "Complete the single row on the Final Jeopardy sheet."],
  [4, "Keep the sheet names and column headings unchanged."],
  [5, "Save as an .xlsx file and upload it from the teacher dashboard."],
];
instructions.getRange("A4:B4").format = { fill: colors.navy, font: { name: font, bold: true, color: colors.white }, borders: { preset: "outside", style: "thin", color: colors.navy } };
instructions.getRange("A5:B9").format.wrapText = true;
instructions.getRange("A4:B9").format.borders = { insideHorizontal: { style: "thin", color: colors.line }, bottom: { style: "thin", color: colors.line } };
instructions.getRange("A11:D11").merge();
instructions.getRange("A11").values = [["Clue-writing note"]];
instructions.getRange("A11").format.font = { name: font, bold: true, color: colors.navy };
instructions.getRange("A12:D13").merge();
instructions.getRange("A12").values = [["The game displays the Clue to teams and keeps the Answer hidden until the teacher reveals it. Questions may be written in any classroom-appropriate style; Jeopardy-style phrasing is optional."]];
instructions.getRange("A12").format = { fill: "#EEF3FF", font: { name: font, color: colors.ink }, wrapText: true };
instructions.getRange("A:A").format.columnWidth = 10;
instructions.getRange("B:B").format.columnWidth = 72;
instructions.getRange("A1:B15").format.autofitRows();

questions.getRange("A1:D1").merge();
questions.getRange("A1").values = [["Jeopardy questions"]];
questions.getRange("A1").format.font = { name: font, size: 18, bold: true, color: colors.navy };
questions.getRange("A2:D2").merge();
questions.getRange("A2").values = [["Six categories × five clues. Replace every yellow cell before importing."]];
questions.getRange("A2").format.font = { name: font, italic: true, color: colors.muted };
questions.getRange("A4:D4").values = [["Category", "Value", "Clue", "Answer"]];
questions.getRange("A4:D4").format = { fill: colors.navy, font: { name: font, bold: true, color: colors.white }, horizontalAlignment: "center", verticalAlignment: "center" };
const questionRows = [];
for (let category = 1; category <= 6; category += 1) {
  for (const value of [100, 200, 300, 400, 500]) questionRows.push([`Category ${category}`, value, "", ""]);
}
questions.getRange("A5:D34").values = questionRows;
questions.getRange("A5:D34").format.fill = colors.input;
questions.getRange("A5:D34").format.borders = { insideHorizontal: { style: "thin", color: colors.line }, bottom: { style: "thin", color: colors.line } };
questions.getRange("B5:B34").format.numberFormat = "0";
questions.getRange("B5:B34").dataValidation = { rule: { type: "list", values: [100, 200, 300, 400, 500] } };
questions.getRange("A:A").format.columnWidth = 24;
questions.getRange("B:B").format.columnWidth = 11;
questions.getRange("C:D").format.columnWidth = 48;
questions.getRange("C5:D34").format.wrapText = true;
questions.getRange("A4:D34").format.verticalAlignment = "center";
questions.freezePanes.freezeRows(4);

final.getRange("A1:C1").merge();
final.getRange("A1").values = [["Final Jeopardy"]];
final.getRange("A1").format.font = { name: font, size: 18, bold: true, color: colors.navy };
final.getRange("A2:C2").merge();
final.getRange("A2").values = [["Complete this single row. All three fields are required."]];
final.getRange("A2").format.font = { name: font, italic: true, color: colors.muted };
final.getRange("A4:C4").values = [["Category", "Clue", "Answer"]];
final.getRange("A4:C4").format = { fill: colors.navy, font: { name: font, bold: true, color: colors.white }, horizontalAlignment: "center" };
final.getRange("A5:C5").values = [["Final category", "", ""]];
final.getRange("A5:C5").format = { fill: colors.input, wrapText: true, verticalAlignment: "center" };
final.getRange("A:A").format.columnWidth = 24;
final.getRange("B:C").format.columnWidth = 54;
final.getRange("A5:C5").format.rowHeight = 52;
final.freezePanes.freezeRows(4);

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of ["Instructions", "Questions", "Final Jeopardy"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1.25, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName.replaceAll(" ", "-")}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, "jeopardy-import-template.xlsx"));

const inspection = await workbook.inspect({ kind: "table", range: "Questions!A1:D12", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 4 });
console.log(inspection.ndjson);
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
console.log(errors.ndjson);
