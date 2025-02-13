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
    let currentTeam: { number: number; name: string } | null = null;
    let currentGame = 1;

    // Parse score lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = line.split('\t');
      console.log(`[ScoreParser] Line ${i} fields:`, fields);

      // Team header line
      if (fields[3] === '*') {
        try {
          currentTeam = {
            number: parseInt(fields[0], 10),
            name: fields[8] || `Team ${fields[0]}`
          };
          console.log('[ScoreParser] Found team:', currentTeam);
          continue;
        } catch (error) {
          console.error('[ScoreParser] Error parsing team header:', error);
          continue;
        }
      }

      // Score line
      if (currentTeam && fields.length >= 11) {
        try {
          // Parse game number from field 1, default to current if invalid
          const gameNum = parseInt(fields[1], 10);
          if (!isNaN(gameNum) && gameNum >= 1 && gameNum <= 3) {
            currentGame = gameNum;
          }

          // Create score object with default values for optional fields
          const score = {
            teamNumber: currentTeam.number,
            teamName: currentTeam.name,
            gameNumber: currentGame,
            position: parseInt(fields[2], 10) || 1,
            qubicaId: fields[4] || '',
            score: parseInt(fields[6] || '0', 10),
            laneNumber: parseInt(fields[7], 10) || 1,
            bowlerName: fields[8] || 'Unknown',
            handicap: parseInt(fields[10] || '0', 10),
            average: parseInt(fields[11] || '0', 10),
            isVacant: fields[5]?.includes('V') || false,
            isAbsent: fields[5]?.includes('A') || false,
            isSub: fields[5]?.includes('S') || false,
          };

          // Validate required numeric fields
          if (isNaN(score.position) || isNaN(score.score) || isNaN(score.laneNumber)) {
            console.warn('[ScoreParser] Invalid numeric fields in score line:', fields);
            continue;
          }

          scores.push(score);
          console.log('[ScoreParser] Added score:', score);
        } catch (error) {
          console.error('[ScoreParser] Error processing score line:', error);
          continue;
        }
      }
    }

    if (scores.length === 0) {
      throw new Error('No valid scores found in file');
    }

    const result = {
      leagueId: 1, // This will be overridden by the route handler
      weekNumber,
      date,
      scores
    };

    console.log('[ScoreParser] Final result:', {
      weekNumber,
      date,
      scoreCount: scores.length,
      firstScore: scores[0],
      lastScore: scores[scores.length - 1]
    });

    return result;
  }
}