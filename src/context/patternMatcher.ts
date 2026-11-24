export interface PatternMatchResult {
  startLine: number;
  endLine: number;
  fromOffset: number;
  toOffset: number;
  text: string;
}

export function extractPatternMatches(
  content: string,
  pattern: string,
  options: { isRegex: boolean; caseSensitive: boolean; contextLines: number },
): PatternMatchResult[] {
  if (!pattern) return [];
  const lines = content.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const flags = options.caseSensitive ? "g" : "gi";
  const regex = options.isRegex
    ? new RegExp(pattern, flags)
    : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

  const matchedLineIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0;
    if (regex.test(lines[i])) {
      matchedLineIndices.add(i);
    }
  }

  if (matchedLineIndices.size === 0) return [];

  const sortedLines = Array.from(matchedLineIndices).sort((a, b) => a - b);
  const ranges: Array<{ startIdx: number; endIdx: number }> = [];
  for (const lineIdx of sortedLines) {
    const startIdx = Math.max(0, lineIdx - options.contextLines);
    const endIdx = Math.min(lines.length - 1, lineIdx + options.contextLines);
    const prev = ranges[ranges.length - 1];
    if (prev && startIdx <= prev.endIdx + 1) {
      prev.endIdx = Math.max(prev.endIdx, endIdx);
    } else {
      ranges.push({ startIdx, endIdx });
    }
  }

  return ranges.map(({ startIdx, endIdx }) => {
    const text = lines.slice(startIdx, endIdx + 1).join("\n");
    const fromOffset = lineOffsets[startIdx] ?? 0;
    const toOffset = fromOffset + text.length;
    return {
      startLine: startIdx + 1,
      endLine: endIdx + 1,
      fromOffset,
      toOffset,
      text,
    };
  });
}
