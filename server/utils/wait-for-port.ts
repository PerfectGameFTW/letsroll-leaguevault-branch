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
  workflow?: string;
  health?: {
    database: boolean;
    vite: boolean;
    server: boolean;
  };
}

// Add workflow detection
function getCurrentWorkflow(): string {
  const npmScript = process.env.npm_lifecycle_event;
  const replWorkflow = process.env.REPL_WORKFLOW_NAME;
  const replSlug = process.env.REPL_SLUG;
  const isDev = process.env.NODE_ENV === 'development' || npmScript === 'dev';

  debugLog('Workflow', 'Detecting current workflow', {
    npm_lifecycle_event: npmScript,
    REPL_WORKFLOW_NAME: replWorkflow,
    REPL_SLUG: replSlug,
    NODE_ENV: process.env.NODE_ENV,
    isDev,
    pwd: process.env.PWD,
    path: process.env.PATH?.split(':')[0]
  });

  // Priority 1: Development environment or dev script should always be "Dev" workflow
  if (isDev) {
    debugLog('Workflow', 'Detected Dev workflow from development environment');
    return 'Dev';
  }

  // Priority 2: Explicit workflow name from environment
  if (replWorkflow) {
    debugLog('Workflow', `Using explicit workflow name: ${replWorkflow}`);
    return replWorkflow;
  }

  // Priority 3: For backwards compatibility, map workspace to Dev in development
  if (replSlug === 'workspace' && process.env.NODE_ENV === 'development') {
    debugLog('Workflow', 'Mapped workspace to Dev workflow in development');
    return 'Dev';
  }

  debugLog('Workflow', 'Using default workflow name');
  return replSlug || 'Unknown';
}

async function readPortStatus(retryCount = 0): Promise<PortStatus | null> {
  const currentWorkflow = getCurrentWorkflow();
  debugLog('PortCheck', `Reading port status for workflow ${currentWorkflow} (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  try {
    const content = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
    const status = JSON.parse(content) as PortStatus;

    debugLog('PortCheck', 'Read port status file:', status);

    // Only consider status files from matching workflow
    if (status.workflow === currentWorkflow) {
      debugLog('PortCheck', 'Found matching workflow status:', status);
      return status;
    }

    debugLog('PortCheck', 'Found status for different workflow:', {
      current: currentWorkflow,
      found: status.workflow
    });
    return null;
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
  const currentWorkflow = getCurrentWorkflow();
  debugLog('Health', `Checking health for workflow ${currentWorkflow} on port ${port}`);

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
    debugLog('Health', 'Health check response:', data);

    // Verify all components are ready and workflow matches
    const isHealthy = data.status === 'healthy' &&
                       data.ready === true &&
                       data.database?.connected === true &&
                       (process.env.NODE_ENV === 'production' || data.vite?.setup === true) &&
                       (!data.workflow || data.workflow === currentWorkflow);

    if (!isHealthy && retryCount < MAX_RETRIES) {
      console.log(`[wait-for-port] Components not ready, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return checkHealth(port, retryCount + 1);
    }

    debugLog('Health', `System health status: ${isHealthy ? 'HEALTHY' : 'NOT HEALTHY'}`);
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

export async function waitForPort() {
  const currentWorkflow = getCurrentWorkflow();
  debugLog('PortWait', `Starting server readiness check for workflow ${currentWorkflow}`);

  const startTime = Date.now();
  let lastLogTime = 0;
  const LOG_INTERVAL = 5000; // Log every 5 seconds

  try {
    while (Date.now() - startTime < TIMEOUT) {
      const currentTime = Date.now();
      const elapsedTime = currentTime - startTime;

      if (currentTime - lastLogTime >= LOG_INTERVAL) {
        debugLog('PortWait', `Still waiting for workflow ${currentWorkflow}... (${Math.round(elapsedTime / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }

      const status = await readPortStatus();
      if (status && status.workflow === currentWorkflow) {
        debugLog('PortWait', `Found port ${status.port} for workflow ${currentWorkflow}, checking health...`);
        if (status.ready) {
          const isHealthy = await checkHealth(status.port);
          if (isHealthy) {
            debugLog('PortWait', `Server is ready on port ${status.port} for workflow ${currentWorkflow}`);
            return status.port;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`Timeout waiting for workflow ${currentWorkflow} after ${TIMEOUT/1000} seconds`);
  } catch (error) {
    debugLog('PortWait', `Error during port wait for workflow ${currentWorkflow}:`, error);
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