import fs from 'fs';
import path from 'path';

const PORT_STATUS_FILE = '.port-status';
const INSTANCE_LOCK_FILE = '.server-instance.lock';

async function cleanup() {
  console.log('Cleaning up server files...');
  
  try {
    // Remove port status file
    if (fs.existsSync(PORT_STATUS_FILE)) {
      fs.unlinkSync(PORT_STATUS_FILE);
      console.log('Removed port status file');
    }
    
    // Remove instance lock file
    if (fs.existsSync(INSTANCE_LOCK_FILE)) {
      fs.unlinkSync(INSTANCE_LOCK_FILE);
      console.log('Removed instance lock file');
    }
    
    console.log('Cleanup completed successfully');
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanup();
