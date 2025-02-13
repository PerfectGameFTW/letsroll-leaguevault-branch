import { Router } from 'express';
import { importQubicaFile } from '../utils/qubica-import';
import { z } from 'zod';

const router = Router();

// Validate request body
const importRequestSchema = z.object({
  leagueId: z.number().positive(),
  fileContent: z.string().min(1),
});

router.post('/qubica', async (req, res) => {
  try {
    const { leagueId, fileContent } = importRequestSchema.parse(req.body);
    
    const result = await importQubicaFile(fileContent, leagueId);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: result.error || 'Failed to import QubicaAMF file',
        },
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error in QubicaAMF import endpoint:', error);
    return res.status(500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
    });
  }
});

export default router;
