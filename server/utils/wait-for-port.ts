import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';

const log = createLogger("WaitForPort");

const PORT_STATUS_FILE = '.port-status';
const TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 100; // 100ms
const MAX_RETRIES = 3; // Maximum number of retries for health checks

export interface WorkflowConfig {
  name: string;
  port: number;
  ready: boolean;
}

interface PortStatus {
  port: number;
  ready: boolean;
  timestamp: string;
  pid?: number;
  mode?: string;
  workflow?: string;
  health?: {
    database: boolean;
    vite: boolean;
    server: boolean;
  };
  wait_for_port?: number;
}

function getCurrentWorkflow(): string {
  if (process.env.REPL_SLUG === 'workspace') {
    log.debug('Running in workspace, using Dev workflow');
    return 'Dev';
  }

  if (process.env.REPL_WORKFLOW_NAME) {
    log.debug(`Using explicit workflow name: ${process.env.REPL_WORKFLOW_NAME}`);
    return process.env.REPL_WORKFLOW_NAME;
  }

  if (process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev') {
    log.debug('Detected development environment');
    return 'Dev';
  }

  log.debug('Using default Dev workflow');
  return 'Dev';
}

async function readPortStatus(retryCount = 0): Promise<PortStatus | null> {
  const currentWorkflow = getCurrentWorkflow();
  log.debug(`Reading port status for workflow ${currentWorkflow} (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  try {
    const filePath = path.resolve(process.cwd(), PORT_STATUS_FILE);
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const status = JSON.parse(content) as PortStatus;

    log.debug('Read port status:', { status, currentWorkflow, isWorkspace: process.env.REPL_SLUG === 'workspace' });

    if (currentWorkflow === 'Dev') {
      if (!status.wait_for_port) {
        status.wait_for_port = 5001;
      }
      log.debug('Dev workflow port status:', {
        port: status.port,
        wait_for_port: status.wait_for_port,
        ready: status.ready,
        health: status.health
      });
      return status;
    }

    return status;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.debug('Port status file not found');
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return readPortStatus(retryCount + 1);
      }
    }
    log.debug('Error reading port status:', error);
    return null;
  }
}

async function checkHealth(port: number, retryCount = 0): Promise<boolean> {
  log.debug(`Checking health on port ${port} (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  try {
    const response = await fetch(`http://0.0.0.0:${port}/api/health`);
    log.debug(`Health check response status: ${response.status}`);

    if (!response.ok) {
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkHealth(port, retryCount + 1);
      }
      return false;
    }

    const data = await response.json();
    log.debug('Health check response:', data);

    const currentWorkflow = getCurrentWorkflow();
    if (currentWorkflow === 'Dev') {
      interface HealthResponse {
        coordination?: {
          port_status?: {
            health?: { server?: boolean; vite?: boolean };
          };
        };
      }
      const healthData = data as HealthResponse;
      const isHealthy = !!(healthData.coordination?.port_status?.health?.server && 
                       healthData.coordination?.port_status?.health?.vite);
      log.debug(`Dev workflow health check: ${isHealthy}`);
      return isHealthy;
    }

    return true;
  } catch (error) {
    log.debug('Health check error:', error);
    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return checkHealth(port, retryCount + 1);
    }
    return false;
  }
}

export async function waitForPort(): Promise<number> {
  const startTime = Date.now();
  const currentWorkflow = getCurrentWorkflow();

  log.debug(`Starting port wait for workflow ${currentWorkflow}`, {
    start_time: new Date(startTime).toISOString(),
    workflow_name: currentWorkflow
  });

  let lastLogTime = startTime;
  const LOG_INTERVAL = 5000;

  try {
    while (Date.now() - startTime < TIMEOUT) {
      const currentTime = Date.now();
      if (currentTime - lastLogTime >= LOG_INTERVAL) {
        const elapsedTime = currentTime - startTime;
        log.debug(`Still waiting for workflow ${currentWorkflow}... (${Math.round(elapsedTime / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }

      const status = await readPortStatus();
      if (status) {
        log.debug('Found port status:', status);

        if (currentWorkflow === 'Dev' && !status.wait_for_port) {
          status.wait_for_port = 5001;
        }

        if (status.ready) {
          const isHealthy = await checkHealth(status.port);
          if (isHealthy) {
            log.debug(`Server is ready on port ${status.port}`);
            return status.port;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`Timeout waiting for workflow ${currentWorkflow} after ${TIMEOUT/1000} seconds`);
  } catch (error) {
    log.debug('Error during port wait:', error);
    throw error;
  }
}

export { getCurrentWorkflow, readPortStatus };

if (require.main === module) {
  waitForPort()
    .then(() => process.exit(0))
    .catch(error => {
      log.error('Fatal error:', error);
      process.exit(1);
    });
}
