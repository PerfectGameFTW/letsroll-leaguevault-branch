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
    const lines = content.split('\n');
    const headerLine = lines[0];

    // Parse header (format: * MM/DD/YYYY HH:MM am/pm\tConqueror X\tLeague Name\tWeek XX\tDate Time\tLeague ID)
    const headerMatch = headerLine.match(/\* (\d{2}\/\d{2}\/\d{4}).*Week (\d+)\t(.*?)\t(\d+)/);
    if (!headerMatch) {
      throw new Error('Invalid file format: Header not found');
    }

    const [, dateStr, weekStr, , leagueIdStr] = headerMatch;
    const date = new Date(dateStr);
    const weekNumber = parseInt(weekStr, 10);
    const leagueId = parseInt(leagueIdStr, 10);

    const scores: ScoreImport['scores'] = [];
    let currentTeam: { number: number; name: string } | null = null;

    // Parse score lines
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;

      const fields = line.split('\t');

      // Team header line
      if (fields[3] === '*') {
        currentTeam = {
          number: parseInt(fields[0], 10),
          name: fields[8]
        };
        continue;
      }

      // Score line
      if (currentTeam && fields.length >= 11) {
        scores.push({
          teamNumber: currentTeam.number,
          teamName: currentTeam.name,
          gameNumber: parseInt(fields[1], 10),
          position: parseInt(fields[2], 10),
          qubicaId: fields[4],
          score: parseInt(fields[6] || '0', 10),
          laneNumber: parseInt(fields[7], 10),
          bowlerName: fields[8],
          handicap: parseInt(fields[10] || '0', 10),
          average: parseInt(fields[11] || '0', 10),
          isVacant: fields[5]?.includes('V') || false,
          isAbsent: fields[5]?.includes('A') || false,
          isSub: fields[5]?.includes('S') || false,
        });
      }
    }

    return {
      leagueId,
      weekNumber,
      date,
      scores
    };
  }
}