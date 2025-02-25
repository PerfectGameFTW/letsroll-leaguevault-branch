import fs from 'fs';
import path from 'path';

const PORT_STATUS_FILE = '.port-status';
const TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 100; // 100ms
const MAX_RETRIES = 3; // Maximum number of retries for health checks

const DEBUG = process.env.DEBUG !== '0';
function debugLog(context: string, message: string, data?: any) {
  if (DEBUG) {
    console.log(`[DEBUG][${context}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

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

// Enhanced getCurrentWorkflow with additional logging
function getCurrentWorkflow(): string {
  // Add more detailed debug logging for workflow detection
  const env = {
    npm_lifecycle_event: process.env.npm_lifecycle_event,
    REPL_WORKFLOW_NAME: process.env.REPL_WORKFLOW_NAME,
    REPL_SLUG: process.env.REPL_SLUG,
    NODE_ENV: process.env.NODE_ENV,
    isDev: process.env.NODE_ENV === 'development',
    npm_lifecycle_script: process.env.npm_lifecycle_script,
    PWD: process.env.PWD
  };

  debugLog('Workflow', 'Detecting workflow from environment', env);

  // Always treat any running process in workspace as Dev
  if (process.env.REPL_SLUG === 'workspace') {
    debugLog('Workflow', 'Running in workspace, using Dev workflow');
    return 'Dev';
  }

  // Explicit workflow name takes precedence
  if (process.env.REPL_WORKFLOW_NAME) {
    debugLog('Workflow', `Using explicit workflow name: ${process.env.REPL_WORKFLOW_NAME}`);
    return process.env.REPL_WORKFLOW_NAME;
  }

  // NPX or development environment indicates Dev workflow
  if (process.env.npm_lifecycle_event === 'npx' ||
      process.env.NODE_ENV === 'development' ||
      process.env.npm_lifecycle_event === 'dev') {
    debugLog('Workflow', 'Detected development environment');
    return 'Dev';
  }

  // Default to Dev for development environment
  debugLog('Workflow', 'Using default Dev workflow');
  return 'Dev';
}

// Update readPortStatus function with enhanced logging
async function readPortStatus(retryCount = 0): Promise<PortStatus | null> {
  const currentWorkflow = getCurrentWorkflow();
  debugLog('PortCheck', `Reading port status for workflow ${currentWorkflow} (attempt ${retryCount + 1}/${MAX_RETRIES})`, {
    cwd: process.cwd(),
    filepath: path.resolve(process.cwd(), PORT_STATUS_FILE),
    env: {
      REPL_SLUG: process.env.REPL_SLUG,
      NODE_ENV: process.env.NODE_ENV,
      npm_lifecycle_event: process.env.npm_lifecycle_event
    }
  });

  try {
    const filePath = path.resolve(process.cwd(), PORT_STATUS_FILE);
    debugLog('PortCheck', `Attempting to read port status from: ${filePath}`);

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const status = JSON.parse(content) as PortStatus;

    debugLog('PortCheck', 'Read port status:', {
      status,
      currentWorkflow,
      isWorkspace: process.env.REPL_SLUG === 'workspace',
      matches: status.workflow === currentWorkflow,
      wait_for_port: status.wait_for_port
    });

    // Consider all workspace instances as Dev workflow
    if (process.env.REPL_SLUG === 'workspace' ||
        status.workflow === 'Dev' ||
        status.mode === 'development') {
      debugLog('PortCheck', 'Found matching workflow status', {
        status,
        ready: status.ready,
        health: status.health,
        wait_for_port: status.wait_for_port
      });

      // For Dev workflow, set explicit wait_for_port
      if (!status.wait_for_port && status.port) {
        status.wait_for_port = status.port;
      }

      // For Dev workflow, consider it ready if either server or vite is healthy
      if (status.ready && (!status.health || status.health.server || status.health.vite)) {
        return status;
      }
      debugLog('PortCheck', 'Workflow found but not ready', status);
    }

    debugLog('PortCheck', 'Found status for different workflow', {
      current: currentWorkflow,
      found: status.workflow,
      health: status.health,
      wait_for_port: status.wait_for_port
    });
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      debugLog('PortCheck', `Port status file not found at ${path.resolve(process.cwd(), PORT_STATUS_FILE)}`, {
        error,
        retryCount
      });
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return readPortStatus(retryCount + 1);
      }
    }
    debugLog('PortCheck', 'Error reading port status:', {
      error,
      retryCount,
      maxRetries: MAX_RETRIES
    });
    return null;
  }
}

async function checkHealth(port: number, retryCount = 0): Promise<boolean> {
  debugLog('Health', `Checking health on port ${port} (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  try {
    const response = await fetch(`http://0.0.0.0:${port}/api/health`);
    debugLog('Health', `Health check response status: ${response.status}`);

    if (!response.ok) {
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkHealth(port, retryCount + 1);
      }
      return false;
    }

    const data = await response.json();
    debugLog('Health', 'Health check response:', data);
    // For Dev workflow, consider healthy if server and vite are running
    if (getCurrentWorkflow() === 'Dev') {
      return data.coordination?.port_status?.health?.server &&
             data.coordination?.port_status?.health?.vite;
    }
    return true;
  } catch (error) {
    debugLog('Health', 'Health check error:', { error, port });
    if (retryCount < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return checkHealth(port, retryCount + 1);
    }
    return false;
  }
}

// Enhanced waitForPort function to better support workflow detection
export async function waitForPort(): Promise<number> {
  const startTime = Date.now();
  const currentWorkflow = getCurrentWorkflow();

  debugLog('PortWait', `Starting port wait for workflow ${currentWorkflow}`, {
    start_time: new Date(startTime).toISOString(),
    environment: process.env,
    workflow_name: currentWorkflow,
    expected_port: 5001 // Dev workflow always uses port 5001
  });

  let lastLogTime = startTime;
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
      if (status) {
        debugLog('PortWait', 'Found port status:', status);

        // For Dev workflow in workspace, server and vite must be healthy
        if (status.ready && currentWorkflow === 'Dev') {
          if (status.health?.server && status.health?.vite) {
            debugLog('PortWait', `Dev workflow is fully ready on port ${status.port}`);
            return status.port;
          } else {
            debugLog('PortWait', 'Waiting for all services to be healthy:', status.health);
          }
        } else if (status.ready) {
          const isHealthy = await checkHealth(status.port);
          if (isHealthy) {
            debugLog('PortWait', `Server is ready on port ${status.port}`);
            return status.port;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`Timeout waiting for workflow ${currentWorkflow} after ${TIMEOUT/1000} seconds`);
  } catch (error) {
    debugLog('PortWait', `Error during port wait:`, { error });
    throw error;
  }
}

// Export other functions
export { getCurrentWorkflow, readPortStatus };

// Start the wait-for-port process
if (require.main === module) {
  waitForPort()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('[wait-for-port] Fatal error:', error);
      process.exit(1);
    });
}