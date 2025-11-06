#!/usr/bin/env node

// ============================================================================
// Ladies Manager - Express Web Server
// ============================================================================
// Endpoints:
// GET /          - Start generation + show HTML UI
// GET /status    - JSON status (for live updates)
// GET /download  - Download ZIP with all generated images/videos
// ============================================================================

import express from 'express';
import { spawn } from 'child_process';
import { readFileSync, existsSync, createWriteStream, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config
let CONFIG;
try {
  const configPath = join(__dirname, 'config.json');
  CONFIG = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.error('❌ Failed to load config.json:', error.message);
  process.exit(1);
}

const app = express();
const PORT = CONFIG.server?.port || 3000;

// Global state
let processingState = {
  isRunning: false,
  startTime: null,
  totalPrompts: 0,
  processedPrompts: 0,
  successCount: 0,
  failCount: 0,
  currentPrompt: '',
  logs: [],
  error: null
};

// Serve static files (HTML, CSS, JS)
app.use(express.static(join(__dirname, 'public')));

// ============================================================================
// GET / - Start Generation
// ============================================================================

app.get('/', (req, res) => {
  // If already running, just show status page
  if (processingState.isRunning) {
    res.sendFile(join(__dirname, 'public', 'index.html'));
    return;
  }

  // Start new generation
  startGeneration();
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// GET /status - JSON Status (for AJAX polling)
// ============================================================================

app.get('/status', (req, res) => {
  const elapsed = processingState.startTime 
    ? Math.round((Date.now() - processingState.startTime) / 1000)
    : 0;

  const percentage = processingState.totalPrompts > 0
    ? Math.round((processingState.processedPrompts / processingState.totalPrompts) * 100)
    : 0;

  res.json({
    isRunning: processingState.isRunning,
    progress: {
      total: processingState.totalPrompts,
      processed: processingState.processedPrompts,
      percentage: percentage,
      success: processingState.successCount,
      failed: processingState.failCount
    },
    currentPrompt: processingState.currentPrompt,
    elapsed: elapsed,
    logs: processingState.logs.slice(-10), // Last 10 log entries
    error: processingState.error,
    downloadReady: !processingState.isRunning && processingState.processedPrompts > 0
  });
});

// ============================================================================
// GET /download - Download ZIP with all images/videos
// ============================================================================

app.get('/download', async (req, res) => {
  try {
    const downloadsDir = join(__dirname, 'downloads');
    
    if (!existsSync(downloadsDir)) {
      return res.status(404).json({ error: 'No files to download yet' });
    }

    // Get all files in downloads directory
    const files = getAllFiles(downloadsDir);

    if (files.length === 0) {
      return res.status(404).json({ error: 'No files found' });
    }

    // Create ZIP archive
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFilename = `ladiesmanager_${timestamp}.zip`;

    res.attachment(zipFilename);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    archive.on('error', (err) => {
      console.error('ZIP error:', err);
      res.status(500).json({ error: 'Failed to create ZIP' });
    });

    archive.pipe(res);

    // Add all files to ZIP
    for (const file of files) {
      const relativePath = file.replace(downloadsDir + '/', '');
      archive.file(file, { name: relativePath });
    }

    await archive.finalize();

    console.log(`✅ ZIP download: ${files.length} files, ${zipFilename}`);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET /trigger - Manual trigger (same as GET /)
// ============================================================================

app.get('/trigger', (req, res) => {
  if (processingState.isRunning) {
    res.json({ 
      success: false, 
      message: 'Generation already running',
      status: processingState 
    });
    return;
  }

  startGeneration();
  res.json({ 
    success: true, 
    message: 'Generation started',
    status: processingState 
  });
});

// ============================================================================
// Start Generation Function
// ============================================================================

function startGeneration() {
  if (processingState.isRunning) {
    console.log('⚠️  Generation already running');
    return;
  }

  console.log('\n🚀 Starting generation process...');

  // Reset state
  processingState = {
    isRunning: true,
    startTime: Date.now(),
    totalPrompts: 0,
    processedPrompts: 0,
    successCount: 0,
    failCount: 0,
    currentPrompt: '',
    logs: [],
    error: null
  };

  // Spawn batch processor
  const processor = spawn('node', ['batch-processor-vps.js'], {
    cwd: __dirname,
    env: process.env
  });

  processor.stdout.on('data', (data) => {
    const log = data.toString().trim();
    console.log(log);

    // Parse log for state updates
    processingState.logs.push({
      time: new Date().toISOString(),
      message: log
    });

    // Extract progress info from logs (basic regex parsing)
    if (log.includes('Processing') && log.includes('prompts')) {
      const match = log.match(/(\d+) prompts/);
      if (match) {
        processingState.totalPrompts = parseInt(match[1]);
      }
    }

    if (log.includes('Processed:')) {
      const match = log.match(/Processed: (\d+)\/(\d+)/);
      if (match) {
        processingState.processedPrompts = parseInt(match[1]);
        processingState.totalPrompts = parseInt(match[2]);
      }
    }

    if (log.includes('Success:')) {
      const match = log.match(/Success: (\d+)/);
      if (match) {
        processingState.successCount = parseInt(match[1]);
      }
    }

    if (log.includes('Failed:')) {
      const match = log.match(/Failed: (\d+)/);
      if (match) {
        processingState.failCount = parseInt(match[1]);
      }
    }
  });

  processor.stderr.on('data', (data) => {
    const error = data.toString().trim();
    console.error('❌', error);
    processingState.logs.push({
      time: new Date().toISOString(),
      message: `ERROR: ${error}`
    });
  });

  processor.on('close', (code) => {
    processingState.isRunning = false;
    
    if (code === 0) {
      console.log('✅ Generation completed successfully');
      processingState.logs.push({
        time: new Date().toISOString(),
        message: '✅ Generation completed successfully!'
      });
    } else {
      console.error(`❌ Generation failed with code ${code}`);
      processingState.error = `Process exited with code ${code}`;
      processingState.logs.push({
        time: new Date().toISOString(),
        message: `❌ Generation failed with code ${code}`
      });
    }
  });

  processor.on('error', (error) => {
    console.error('❌ Failed to start processor:', error);
    processingState.isRunning = false;
    processingState.error = error.message;
    processingState.logs.push({
      time: new Date().toISOString(),
      message: `❌ Failed to start: ${error.message}`
    });
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = join(dirPath, file);
    if (statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🎨 LADIES MANAGER - WEB SERVER');
  console.log('='.repeat(60));
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Public URL: https://ladiesmanager.srv879239.hstgr.cloud`);
  console.log('\nEndpoints:');
  console.log(`  GET /          - Start generation + UI`);
  console.log(`  GET /status    - JSON status`);
  console.log(`  GET /download  - Download ZIP`);
  console.log(`  GET /trigger   - Manual trigger`);
  console.log('='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down gracefully');
  process.exit(0);
});
