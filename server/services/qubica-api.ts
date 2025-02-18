import { z } from 'zod';

// Configuration validation schema
const qubicaConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  centerId: z.string().min(1),
});

type QubicaConfig = z.infer<typeof qubicaConfigSchema>;

// API response types
interface QubicaApiError {
  code: string;
  message: string;
}

interface QubicaApiResponse<T> {
  success: boolean;
  data?: T;
  error?: QubicaApiError;
}

// Score types matching the API response structure
interface QubicaLane {
  laneNumber: number;
  status: string;
  currentGame: number;
  bowlers: QubicaBowler[];
}

interface QubicaBowler {
  position: number;
  name: string;
  currentScore: number;
  handicap: number;
  average: number;
  frames: QubicaFrame[];
}

interface QubicaFrame {
  number: number;
  rolls: string[];
  score: number;
  isComplete: boolean;
}

export class QubicaApiService {
  private config: QubicaConfig;

  constructor() {
    const config = {
      baseUrl: process.env.QUBICA_API_URL,
      apiKey: process.env.QUBICA_API_KEY,
      centerId: process.env.QUBICA_CENTER_ID,
    };

    try {
      this.config = qubicaConfigSchema.parse(config);
    } catch (error) {
      console.error('[QubicaAPI] Configuration error:', error);
      throw new Error('Invalid QubicaAMF API configuration');
    }
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(endpoint, this.config.baseUrl);
    const searchParams = new URLSearchParams({
      ...params,
      apiKey: this.config.apiKey,
      centerId: this.config.centerId,
    });

    url.search = searchParams.toString();

    try {
      console.log(`[QubicaAPI] Requesting: ${url.toString()}`);
      const response = await fetch(url.toString());
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      console.error('[QubicaAPI] Request error:', error);
      throw error;
    }
  }

  /**
   * Get current scores for a specific league session
   */
  async getCurrentScores(leagueId: string, sessionId: string): Promise<QubicaApiResponse<QubicaLane[]>> {
    return this.request('/scores/current', {
      leagueId,
      sessionId,
    });
  }

  /**
   * Get detailed score information for a specific lane
   */
  async getLaneScores(laneNumber: number): Promise<QubicaApiResponse<QubicaLane>> {
    return this.request('/scores/lane', {
      laneNumber: laneNumber.toString(),
    });
  }

  /**
   * Get all active sessions for a league
   */
  async getActiveSessions(leagueId: string): Promise<QubicaApiResponse<string[]>> {
    return this.request('/sessions/active', {
      leagueId,
    });
  }
}

// Export singleton instance
export const qubicaApi = new QubicaApiService();
