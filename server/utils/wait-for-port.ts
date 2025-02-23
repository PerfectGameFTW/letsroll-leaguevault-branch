import fs from 'fs';
import path from 'path';

const PORT_STATUS_FILE = '.port-status';
const TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 100; // 100ms
const MAX_RETRIES = 3; // Maximum number of retries for health checks

const DEBUG = true;
function debugLog(context: string, message: string, data?: any) {
  if (DEBUG) {
    console.log(`[DEBUG][${context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

interface PortStatus {
  port: number;
  ready: boolean;
  timestamp: string;
  pid?: number;
  mode?: string;
  health?: {
    database: boolean;
    vite: boolean;
    server: boolean;
  };
}

async function readPortStatus(retryCount = 0): Promise<PortStatus | null> {
  debugLog('PortCheck', `Reading port status (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  try {
    const content = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
    const status = JSON.parse(content) as PortStatus;
    debugLog('PortCheck', 'Successfully read port status:', status);
    return status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      debugLog('PortCheck', 'Port status file not found');
      if (retryCount < MAX_RETRIES) {
        debugLog('PortCheck', `Retrying in 1 second... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return readPortStatus(retryCount + 1);
      }
      debugLog('PortCheck', 'Max retries reached, giving up');
      return null;
    }
    debugLog('PortCheck', 'Error reading port status:', error);
    return null;
  }
}

async function checkHealth(port: number, retryCount = 0): Promise<boolean> {
  try {
    console.log(`[wait-for-port] Checking health endpoint on port ${port}...`);
    const response = await fetch(`http://localhost:${port}/api/health`);

    if (!response.ok) {
      if (retryCount < MAX_RETRIES) {
        console.log(`[wait-for-port] Health check failed (${response.status}), retrying (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkHealth(port, retryCount + 1);
      }
      console.log(`[wait-for-port] Health check failed with status ${response.status} after maximum retries`);
      return false;
    }

    const data = await response.json();
    console.log('[wait-for-port] Health check response:', data);

    // Verify all components are ready
    const isHealthy = data.status === 'healthy' &&
                     data.ready === true &&
                     data.database?.connected === true &&
                     (process.env.NODE_ENV === 'production' || data.vite?.setup === true);

    if (!isHealthy && retryCount < MAX_RETRIES) {
      console.log(`[wait-for-port] Components not ready, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return checkHealth(port, retryCount + 1);
    }

    console.log('[wait-for-port] System health status:', isHealthy ? 'HEALTHY' : 'NOT HEALTHY');
    return isHealthy;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`[wait-for-port] Health check error, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return checkHealth(port, retryCount + 1);
    }
    console.error('[wait-for-port] Health check error after maximum retries:', error);
    return false;
  }
}

function getEnvironmentInfo() {
  debugLog('Environment', 'Current environment:', {
    NODE_ENV: process.env.NODE_ENV,
    REPL_SLUG: process.env.REPL_SLUG,
    REPL_OWNER: process.env.REPL_OWNER,
    PWD: process.env.PWD,
    PATH: process.env.PATH
  });
}

export async function waitForPort() {
  debugLog('PortWait', 'Starting server readiness check');
  getEnvironmentInfo();

  const startTime = Date.now();
  let lastLogTime = 0;
  const LOG_INTERVAL = 5000; // Log every 5 seconds

  try {
    while (Date.now() - startTime < TIMEOUT) {
      const currentTime = Date.now();
      const elapsedTime = currentTime - startTime;

      if (currentTime - lastLogTime >= LOG_INTERVAL) {
        debugLog('PortWait', `Still waiting... (${Math.round(elapsedTime / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }

      const status = await readPortStatus();
      if (status) {
        debugLog('PortWait', `Found port ${status.port}, checking health...`);
        if (status.ready) {
          const isHealthy = await checkHealth(status.port);
          if (isHealthy) {
            debugLog('PortWait', `Server is ready on port ${status.port}`);
            return status.port;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`Timeout waiting for server after ${TIMEOUT/1000} seconds`);
  } catch (error) {
    debugLog('PortWait', 'Error during port wait:', error);
    throw error;
  }
}

// Start the wait-for-port process
if (require.main === module) {
  waitForPort()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('[wait-for-port] Fatal error:', error);
      process.exit(1);
    });
}