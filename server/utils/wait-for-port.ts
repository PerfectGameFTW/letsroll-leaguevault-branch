import fs from 'fs';
import path from 'path';

const PORT_STATUS_FILE = '.port-status';
const TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 100; // 100ms

interface PortStatus {
  port: number;
  ready: boolean;
  timestamp: string;
}

async function readPortStatus(): Promise<PortStatus | null> {
  try {
    const content = await fs.promises.readFile(PORT_STATUS_FILE, 'utf-8');
    return JSON.parse(content) as PortStatus;
  } catch (error) {
    return null;
  }
}

async function checkHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/health`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'healthy' && data.ready === true;
  } catch (error) {
    return false;
  }
}

async function waitForPort() {
  console.log('Waiting for server to be ready...');
  const startTime = Date.now();

  while (Date.now() - startTime < TIMEOUT) {
    const status = await readPortStatus();
    
    if (status) {
      console.log(`Found port status: ${JSON.stringify(status)}`);
      
      if (status.ready) {
        const isHealthy = await checkHealth(status.port);
        if (isHealthy) {
          console.log(`Server is ready on port ${status.port}`);
          process.exit(0);
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  console.error('Timeout waiting for server to be ready');
  process.exit(1);
}

waitForPort().catch(error => {
  console.error('Error waiting for server:', error);
  process.exit(1);
});
