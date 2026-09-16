const JSPDF_URL = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";

const COLORS = {
  navy: [7, 31, 104],
  blue: [18, 68, 198],
  gold: [248, 198, 76],
  ink: [24, 34, 59],
  muted: [91, 104, 133],
  paleBlue: [238, 243, 255],
  paleGold: [255, 248, 225],
  answer: [22, 100, 65],
  white: [255, 255, 255],
};

const PAGE = { width: 612, height: 792, margin: 44, contentWidth: 524, footerTop: 758 };
let jsPdfPromise;

function loadJsPdf() {
  jsPdfPromise ??= import(JSPDF_URL);
  return jsPdfPromise;
}

export function answerKeyFilename(title) {
  const safeTitle = String(title ?? "jeopardy")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "jeopardy";
  return `${safeTitle}-answer-key.pdf`;
}

function validateSet(set) {
  if (!set?.title || !Array.isArray(set?.board_json?.categories) || !set?.final_json) {
    throw new Error("This game set does not contain a complete answer key.");
  }
}

function setTextColor(doc, color) {
  doc.setTextColor(...color);
}

function setFillColor(doc, color) {
  doc.setFillColor(...color);
}

function addPageHeader(doc, title, continued = false) {
  setFillColor(doc, COLORS.navy);
  doc.rect(0, 0, PAGE.width, 62, "F");
  setTextColor(doc, COLORS.gold);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("CLASSROOM JEOPARDY", PAGE.margin, 24);
  setTextColor(doc, COLORS.white);
  doc.setFontSize(18);
  doc.text(title, PAGE.margin, 47, { maxWidth: PAGE.contentWidth - 100 });
  if (continued) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Answer key - continued", PAGE.width - PAGE.margin, 25, { align: "right" });
  }
}

function addFooter(doc, pageNumber, pageCount) {
  doc.setDrawColor(206, 215, 234);
  doc.line(PAGE.margin, PAGE.footerTop, PAGE.width - PAGE.margin, PAGE.footerTop);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTextColor(doc, COLORS.muted);
  doc.text("Teacher answer key - keep private", PAGE.margin, 775);
  doc.text(`Page ${pageNumber} of ${pageCount}`, PAGE.width - PAGE.margin, 775, { align: "right" });
}

function createWriter(doc, title) {
  let y = 116;

  const newPage = () => {
    doc.addPage();
    addPageHeader(doc, title, true);
    y = 84;
  };

  const ensureSpace = (height) => {
    if (y + height > PAGE.footerTop - 12) newPage();
  };

  const category = (name, isFinal = false) => {
    ensureSpace(38);
    setFillColor(doc, isFinal ? COLORS.gold : COLORS.blue);
    doc.roundedRect(PAGE.margin, y, PAGE.contentWidth, 27, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    setTextColor(doc, isFinal ? COLORS.ink : COLORS.white);
    doc.text(isFinal ? `FINAL JEOPARDY - ${name}` : name.toUpperCase(), PAGE.margin + 12, y + 18, {
      maxWidth: PAGE.contentWidth - 24,
    });
    y += 37;
  };

  const clue = (value, question, answer) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    const questionLines = doc.splitTextToSize(String(question), PAGE.contentWidth - 82);
    doc.setFont("helvetica", "bold");
    const answerLines = doc.splitTextToSize(`Answer: ${answer}`, PAGE.contentWidth - 24);
    const height = 23 + (questionLines.length * 13) + (answerLines.length * 13);
    ensureSpace(height + 9);

    setFillColor(doc, COLORS.paleBlue);
    doc.roundedRect(PAGE.margin, y, PAGE.contentWidth, height, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    setTextColor(doc, COLORS.blue);
    doc.text(value, PAGE.margin + 12, y + 18);
    doc.setFont("helvetica", "normal");
    setTextColor(doc, COLORS.ink);
    doc.text(questionLines, PAGE.margin + 70, y + 18);
    const answerY = y + 18 + (questionLines.length * 13) + 3;
    doc.setFont("helvetica", "bold");
    setTextColor(doc, COLORS.answer);
    doc.text(answerLines, PAGE.margin + 12, answerY);
    y += height + 9;
  };

  return { category, clue };
}

export async function createAnswerKeyPdf(set) {
  validateSet(set);
  const { jsPDF } = await loadJsPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
  doc.setProperties({
    title: `${set.title} Answer Key`,
    subject: "Classroom Jeopardy teacher answer key",
    author: "Classroom Jeopardy",
  });
  addPageHeader(doc, set.title);
  const writer = createWriter(doc, set.title);

  setFillColor(doc, COLORS.paleGold);
  doc.roundedRect(PAGE.margin, 72, PAGE.contentWidth, 30, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  setTextColor(doc, COLORS.ink);
  doc.text("Teacher copy: questions and correct responses", PAGE.margin + 10, 91);

  for (const category of set.board_json.categories) {
    writer.category(String(category.name));
    for (const item of category.clues ?? []) {
      writer.clue(`$${Number(item.value).toLocaleString()}`, String(item.clue), String(item.answer));
    }
  }

  writer.category(String(set.final_json.category), true);
  writer.clue("FINAL", String(set.final_json.clue), String(set.final_json.answer));

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    addFooter(doc, pageNumber, pageCount);
  }
  return doc;
}

export async function downloadAnswerKey(set) {
  const doc = await createAnswerKeyPdf(set);
  doc.save(answerKeyFilename(set.title));
}
