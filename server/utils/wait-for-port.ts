import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

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

function getCurrentWorkflow(): string {
  // Always treat workspace as Dev
  if (process.env.REPL_SLUG === 'workspace') {
    debugLog('Workflow', 'Running in workspace, using Dev workflow');
    return 'Dev';
  }

  // Explicit workflow name takes precedence
  if (process.env.REPL_WORKFLOW_NAME) {
    debugLog('Workflow', `Using explicit workflow name: ${process.env.REPL_WORKFLOW_NAME}`);
    return process.env.REPL_WORKFLOW_NAME;
  }

  // Development environment indicates Dev workflow
  if (process.env.NODE_ENV === 'development' || process.env.npm_lifecycle_event === 'dev') {
    debugLog('Workflow', 'Detected development environment');
    return 'Dev';
  }

  // Default to Dev
  debugLog('Workflow', 'Using default Dev workflow');
  return 'Dev';
}

async function readPortStatus(retryCount = 0): Promise<PortStatus | null> {
  const currentWorkflow = getCurrentWorkflow();
  debugLog('PortCheck', `Reading port status for workflow ${currentWorkflow} (attempt ${retryCount + 1}/${MAX_RETRIES})`);

  try {
    const filePath = path.resolve(process.cwd(), PORT_STATUS_FILE);
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const status = JSON.parse(content) as PortStatus;

    debugLog('PortCheck', 'Read port status:', {
      status,
      currentWorkflow,
      isWorkspace: process.env.REPL_SLUG === 'workspace'
    });

    // For Dev workflow, ensure wait_for_port is set
    if (currentWorkflow === 'Dev') {
      if (!status.wait_for_port) {
        status.wait_for_port = 5001; // Default port for Dev workflow
      }
      debugLog('PortCheck', 'Dev workflow port status:', {
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
      debugLog('PortCheck', 'Port status file not found');
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return readPortStatus(retryCount + 1);
      }
    }
    debugLog('PortCheck', 'Error reading port status:', error);
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

    // For Dev workflow, both server and vite must be healthy
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
      debugLog('Health', `Dev workflow health check: ${isHealthy}`);
      return isHealthy;
    }

    return true;
  } catch (error) {
    debugLog('Health', 'Health check error:', error);
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

  debugLog('PortWait', `Starting port wait for workflow ${currentWorkflow}`, {
    start_time: new Date(startTime).toISOString(),
    workflow_name: currentWorkflow
  });

  let lastLogTime = startTime;
  const LOG_INTERVAL = 5000; // Log every 5 seconds

  try {
    while (Date.now() - startTime < TIMEOUT) {
      const currentTime = Date.now();
      if (currentTime - lastLogTime >= LOG_INTERVAL) {
        const elapsedTime = currentTime - startTime;
        debugLog('PortWait', `Still waiting for workflow ${currentWorkflow}... (${Math.round(elapsedTime / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }

      const status = await readPortStatus();
      if (status) {
        debugLog('PortWait', 'Found port status:', status);

        // Ensure wait_for_port is set for Dev workflow
        if (currentWorkflow === 'Dev' && !status.wait_for_port) {
          status.wait_for_port = 5001;
        }

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

    throw new Error(`Timeout waiting for workflow ${currentWorkflow} after ${TIMEOUT/1000} seconds`);
  } catch (error) {
    debugLog('PortWait', 'Error during port wait:', error);
    throw error;
  }
}

// Export utility functions
export { getCurrentWorkflow, readPortStatus };

// Start wait-for-port process if run directly
if (require.main === module) {
  waitForPort()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('[wait-for-port] Fatal error:', error);
      process.exit(1);
    });
}