import { z } from "zod";

// Score import validation schema
export const scoreImportSchema = z.object({
  leagueId: z.number().positive(),
  weekNumber: z.number().positive(),
  date: z.coerce.date(),
  scores: z.array(z.object({
    teamNumber: z.number().positive(),
    teamName: z.string(),
    gameNumber: z.number().min(1).max(3),
    position: z.number().min(1).max(4),
    qubicaId: z.string(),
    score: z.number().min(0).max(300),
    laneNumber: z.number().positive(),
    bowlerName: z.string(),
    handicap: z.number().min(0),
    average: z.number().min(0),
    isVacant: z.boolean().default(false),
    isAbsent: z.boolean().default(false),
    isSub: z.boolean().default(false),
  }))
});

export type ScoreImport = z.infer<typeof scoreImportSchema>;

// Parser for Conqueror X S00 files
export class ConquerorScoreParser {
  async parse(buffer: Buffer): Promise<ScoreImport> {
    const content = buffer.toString('utf-8');
    console.log('[ScoreParser] Raw content first 500 chars:', content.substring(0, 500));

    const lines = content.split('\n');
    console.log('[ScoreParser] Total lines:', lines.length);

    if (lines.length === 0) {
      throw new Error('Invalid file format: File is empty');
    }

    // Parse header
    const headerLine = lines[0];
    console.log('[ScoreParser] Header line:', headerLine);

    // Parse header (format: * MM/DD/YYYY HH:MM am/pm\tConqueror X\tLeague Name\tWeek XX\tDate Time\tLeague ID)
    const headerMatch = headerLine.match(/\* (\d{2}\/\d{2}\/\d{4}).*Week\s+(\d+)/i);
    if (!headerMatch) {
      console.error('[ScoreParser] Header parsing failed for line:', headerLine);
      throw new Error('Invalid file format: Header not found or malformed');
    }

    const [, dateStr, weekStr] = headerMatch;
    const date = new Date(dateStr);
    const weekNumber = parseInt(weekStr, 10);

    console.log('[ScoreParser] Parsed header:', { date, weekNumber });

    const scores: ScoreImport['scores'] = [];

    // Parse each line (skipping header and empty lines)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = line.split('\t');
      console.log(`[ScoreParser] Line ${i} fields:`, fields);

      // Skip lines that don't have enough fields for a score record
      if (fields.length < 12) continue;

      try {
        // All required fields should be present on each score line
        const teamNumber = parseInt(fields[0], 10);
        const gameNumber = parseInt(fields[1], 10);
        const position = parseInt(fields[2], 10);
        const qubicaId = fields[4];
        const score = parseInt(fields[6], 10);
        const laneNumber = parseInt(fields[7], 10);
        const bowlerName = fields[8];
        const handicap = parseInt(fields[10], 10);
        const average = parseInt(fields[11], 10);

        // Skip lines where numeric fields can't be parsed or are out of range
        if (isNaN(teamNumber) || isNaN(gameNumber) || isNaN(position) || isNaN(score) || isNaN(laneNumber)) {
          console.warn('[ScoreParser] Invalid numeric fields on line:', i + 1);
          continue;
        }

        // Skip lines where game number is out of range
        if (gameNumber < 1 || gameNumber > 3) {
          console.warn('[ScoreParser] Invalid game number on line:', i + 1);
          continue;
        }

        // Parse flags from field 5 (status field)
        const statusField = fields[5] || '';
        const isVacant = statusField.includes('V');
        const isAbsent = statusField.includes('A');
        const isSub = statusField.includes('S');

        // Create score record
        const scoreRecord = {
          teamNumber,
          teamName: fields[8] || `Team ${teamNumber}`,
          gameNumber,
          position,
          qubicaId,
          score,
          laneNumber,
          bowlerName,
          handicap: isNaN(handicap) ? 0 : handicap,
          average: isNaN(average) ? 0 : average,
          isVacant,
          isAbsent,
          isSub
        };

        scores.push(scoreRecord);
        console.log('[ScoreParser] Added score:', scoreRecord);

      } catch (error) {
        console.error('[ScoreParser] Error processing line:', i + 1, error);
        continue;
      }
    }

    if (scores.length === 0) {
      throw new Error('No valid scores found in file');
    }

    console.log('[ScoreParser] Parsed scores:', scores.length);

    return {
      leagueId: 1, // This will be overridden by the route handler
      weekNumber,
      date,
      scores
    };
  }
}