import fs from 'fs';
import path from 'path';

const PORT_STATUS_FILE = '.port-status';
const TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 100; // 100ms
const MAX_RETRIES = 3; // Maximum number of retries for health checks

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

interface HealthCheckResponse {
  status: string;
  port: number;
  ready: boolean;
  mode?: string;
  timestamp: string;
  database?: {
    connected: boolean;
    url: string;
  };
  vite?: {
    setup: boolean;
  };
}

async function readPortStatus(retryCount = 0): Promise<PortStatus | null> {
  try {
    console.log('[wait-for-port] Reading port status file...');
    const content = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
    const status = JSON.parse(content) as PortStatus;
    console.log('[wait-for-port] Current port status:', status);
    return status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (retryCount < MAX_RETRIES) {
        console.log(`[wait-for-port] Port status file not found, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return readPortStatus(retryCount + 1);
      }
      console.log('[wait-for-port] Port status file not found after maximum retries');
      return null;
    }
    console.error('[wait-for-port] Error reading port status:', error);
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

    const data = await response.json() as HealthCheckResponse;
    console.log('[wait-for-port] Health check response:', data);

    // Verify all components are ready
    const isHealthy = data.status === 'healthy' && 
                     data.ready === true && 
                     data.database?.connected === true &&
                     data.vite?.setup === true;

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

async function waitForPort() {
  console.log('[wait-for-port] Starting server readiness check...');
  const startTime = Date.now();
  let lastLogTime = 0;
  const LOG_INTERVAL = 5000; // Log every 5 seconds

  while (Date.now() - startTime < TIMEOUT) {
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;

    // Log progress periodically
    if (currentTime - lastLogTime >= LOG_INTERVAL) {
      console.log(`[wait-for-port] Waiting for server... (${Math.round(elapsedTime / 1000)}s elapsed)`);
      lastLogTime = currentTime;
    }

    const status = await readPortStatus();

    if (status) {
      console.log(`[wait-for-port] Found port ${status.port}, checking health...`);

      if (status.ready) {
        const isHealthy = await checkHealth(status.port);
        if (isHealthy) {
          console.log(`[wait-for-port] Server is fully ready on port ${status.port}`);
          process.exit(0);
        } else {
          console.log('[wait-for-port] Server is not yet healthy, continuing to wait...');
        }
      } else {
        console.log('[wait-for-port] Server not marked as ready yet, continuing to wait...');
      }
    } else {
      console.log('[wait-for-port] No port status file found yet, continuing to wait...');
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  console.error(`[wait-for-port] Timeout waiting for server after ${TIMEOUT/1000} seconds`);
  process.exit(1);
}

// Start the wait-for-port process with error handling
process.on('unhandledRejection', (error) => {
  console.error('[wait-for-port] Unhandled promise rejection:', error);
  process.exit(1);
});

waitForPort().catch(error => {
  console.error('[wait-for-port] Fatal error waiting for server:', error);
  process.exit(1);
});