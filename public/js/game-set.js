export const JEOPARDY_VALUES = [100, 200, 300, 400, 500];
export const CATEGORY_COUNT = 6;

function clean(value) {
  return String(value ?? "").trim();
}

function findColumn(headers, names) {
  const accepted = names.map((name) => name.toLowerCase());
  return headers.findIndex((header) => accepted.includes(clean(header).toLowerCase()));
}

export function extractWorksheetRows(matrix, { includeValue = false, sheetName = "Worksheet" } = {}) {
  if (!Array.isArray(matrix)) throw new Error(`${sheetName} could not be read.`);
  const headerIndex = matrix.findIndex((row) => {
    if (!Array.isArray(row)) return false;
    const headers = row.map((cell) => clean(cell).toLowerCase());
    return headers.includes("category")
      && headers.includes("answer")
      && (headers.includes("clue") || headers.includes("question"))
      && (!includeValue || headers.includes("value"));
  });
  if (headerIndex < 0) throw new Error(`${sheetName} needs Category, ${includeValue ? "Value, " : ""}Clue, and Answer headings.`);

  const headers = matrix[headerIndex];
  const categoryIndex = findColumn(headers, ["Category"]);
  const valueIndex = includeValue ? findColumn(headers, ["Value"]) : -1;
  const clueIndex = findColumn(headers, ["Clue", "Question"]);
  const answerIndex = findColumn(headers, ["Answer"]);

  return matrix.slice(headerIndex + 1)
    .map((row, offset) => ({ row, rowNumber: headerIndex + offset + 2 }))
    .filter(({ row }) => Array.isArray(row) && row.some((cell) => clean(cell)))
    .map(({ row, rowNumber }) => ({
      Category: row[categoryIndex] ?? "",
      ...(includeValue ? { Value: row[valueIndex] ?? "" } : {}),
      Clue: row[clueIndex] ?? "",
      Answer: row[answerIndex] ?? "",
      _rowNumber: rowNumber,
    }));
}

export function normalizeImportedGame(title, questionRows, finalRow) {
  const gameTitle = clean(title);
  if (!gameTitle || gameTitle.length > 80) throw new Error("Enter a game-set title up to 80 characters.");
  if (!Array.isArray(questionRows)) throw new Error("The Questions sheet could not be read.");

  const categoryMap = new Map();
  questionRows.forEach((row, index) => {
    const category = clean(row.Category ?? row.category);
    const clue = clean(row.Clue ?? row.Question ?? row.clue ?? row.question);
    const answer = clean(row.Answer ?? row.answer);
    const value = Number(row.Value ?? row.value);
    if (!category && !clue && !answer && !value) return;
    if (!category || !clue || !answer || !JEOPARDY_VALUES.includes(value)) {
      throw new Error(`Questions row ${row._rowNumber ?? index + 2} needs a category, value (100–500), clue, and answer.`);
    }
    const categoryKey = category.toLocaleLowerCase();
    if (!categoryMap.has(categoryKey)) categoryMap.set(categoryKey, { name: category, clues: [] });
    categoryMap.get(categoryKey).clues.push({ value, clue, answer });
  });

  if (categoryMap.size !== CATEGORY_COUNT) {
    throw new Error(`A game set must contain exactly ${CATEGORY_COUNT} categories.`);
  }
  const categories = [...categoryMap.values()].map(({ name, clues }) => {
    clues.sort((left, right) => left.value - right.value);
    if (
      clues.length !== JEOPARDY_VALUES.length ||
      clues.some((clue, index) => clue.value !== JEOPARDY_VALUES[index])
    ) {
      throw new Error(`${name} must have one clue for each value: ${JEOPARDY_VALUES.join(", ")}.`);
    }
    return { name, clues };
  });

  const final = {
    category: clean(finalRow?.Category ?? finalRow?.category),
    clue: clean(finalRow?.Clue ?? finalRow?.Question ?? finalRow?.clue ?? finalRow?.question),
    answer: clean(finalRow?.Answer ?? finalRow?.answer),
  };
  if (!final.category || !final.clue || !final.answer) {
    throw new Error("The Final Jeopardy sheet needs a category, clue, and answer.");
  }
  return { title: gameTitle, board: { categories }, final };
}

export function clueKey(categoryIndex, clueIndex) {
  return `${categoryIndex}:${clueIndex}`;
}
