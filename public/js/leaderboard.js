export function ordinalPlace(place) {
  const value = Number(place);
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

export function rankTeams(teams) {
  const sorted = [...(teams ?? [])].sort((left, right) => Number(right.score) - Number(left.score));
  let previousScore;
  let rank = 0;
  return sorted.map((team, index) => {
    const score = Number(team.score);
    if (index === 0 || score !== previousScore) rank = index + 1;
    previousScore = score;
    return { ...team, rank, place: ordinalPlace(rank) };
  });
}

const IRREGULAR_PLURALS = new Set([
  "children", "feet", "geese", "men", "mice", "people", "teeth", "women",
]);

export function teamNameUsesPluralVerb(name) {
  const cleanName = String(name ?? "").trim();
  if (/(?:\band\b|&)/i.test(cleanName)) return true;
  const words = cleanName.toLowerCase().match(/[a-z]+/g) ?? [];
  const lastWord = words.at(-1) ?? "";
  if (IRREGULAR_PLURALS.has(lastWord)) return true;
  return lastWord.endsWith("s") && !/(?:ss|us|is)$/.test(lastWord);
}

export function winnerAnnouncement(name) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return "We have a winner!";
  return `${cleanName} ${teamNameUsesPluralVerb(cleanName) ? "win" : "wins"}!`;
}
