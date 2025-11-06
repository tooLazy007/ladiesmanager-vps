#!/usr/bin/env node

// ============================================================================
// Ladies Manager - Batch Processor (VPS Version)
// ============================================================================
// Cleaned version: FAL.ai only (Wavespeed removed)
// Features: Gemini Analysis, Kling Video, Rate Limiting, Circuit Breaker
// ============================================================================

import { readFileSync, mkdirSync, existsSync, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import http from 'http';
import https from 'https';

// ============================================================================
// CONFIGURATION LOADER
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let CONFIG;
try {
  const configPath = join(__dirname, 'config.json');
  const configFile = readFileSync(configPath, 'utf-8');
  CONFIG = JSON.parse(configFile);
  console.log('✅ Configuration loaded from config.json');
} catch (error) {
  console.error('❌ Failed to load config.json:', error.message);
  console.error('   Make sure config.json exists in the same directory');
  process.exit(1);
}

// Validate required configuration
function validateConfig() {
  const errors = [];

  if (!CONFIG.airtable?.token) {
    errors.push('Airtable token is missing');
  }

  if (!CONFIG.airtable?.baseId) {
    errors.push('Airtable base ID is missing');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(err => console.error('   - ' + err));
    process.exit(1);
  }
}

validateConfig();

// Check Node.js version
const nodeVersion = parseInt(process.version.slice(1).split('.')[0]);
if (nodeVersion < 18) {
  console.error('❌ Node.js 18+ required!');
  console.error(`   Current version: ${process.version}`);
  process.exit(1);
}

console.log(`✅ Node.js ${process.version} detected`);

// ============================================================================
// CONNECTION POOLING (HTTP AGENTS)
// ============================================================================

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 120000,
  keepAliveMsecs: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 120000,
  keepAliveMsecs: 30000
});

console.log('✅ Connection pool configured');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function arrayToBase64(bytes) {
  const CHUNK = 0x8000;
  let str = '';

  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    str += String.fromCharCode.apply(null, chunk);
  }

  return btoa(str);
}

// ============================================================================
// RATE LIMITER (Token Bucket for Gemini)
// ============================================================================

class RateLimiter {
  constructor(requestsPerMinute) {
    this.rpm = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.lastRefill = Date.now();
    this.totalRequests = 0;
    this.totalWaitTime = 0;
  }

  async acquire() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Refill tokens based on elapsed time
    const tokensToAdd = (elapsed / 60000) * this.rpm;
    this.tokens = Math.min(this.rpm, this.tokens + tokensToAdd);

    if (elapsed >= 1000) {
      this.lastRefill = now;
    }

    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.totalRequests++;
      return;
    }

    // Wait until next token available
    const waitTime = ((1 - this.tokens) / this.rpm) * 60000;
    this.totalWaitTime += waitTime;

    await sleep(waitTime);
    this.tokens = 0;
    this.totalRequests++;
  }

  getStats() {
    return {
      totalRequests: this.totalRequests,
      totalWaitTime: Math.round(this.totalWaitTime / 1000),
      averageWaitTime: this.totalRequests > 0 ? Math.round(this.totalWaitTime / this.totalRequests) : 0
    };
  }
}

// ============================================================================
// CONCURRENCY LIMITER
// ============================================================================

class ConcurrencyLimiter {
  constructor(maxConcurrent) {
    this.max = maxConcurrent;
    this.running = 0;
    this.queue = [];
    this.totalExecuted = 0;
  }

  async run(fn) {
    while (this.running >= this.max) {
      await new Promise(resolve => this.queue.push(resolve));
    }

    this.running++;

    try {
      const result = await fn();
      this.totalExecuted++;
      return result;
    } finally {
      this.running--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }

  getStats() {
    return {
      running: this.running,
      queued: this.queue.length,
      totalExecuted: this.totalExecuted
    };
  }
}

// ============================================================================
// UPLOAD LIMITER (for bandwidth throttling)
// ============================================================================

class UploadLimiter {
  constructor(maxUpload, baseTimeoutMs, fallbackConcurrency = 2) {
    this.max = maxUpload;
    this.baseTimeout = baseTimeoutMs;
    this.fallbackConcurrency = fallbackConcurrency;
    this.uploading = 0;
    this.queue = [];
    this.recentUploadTimes = [];
    this.totalUploads = 0;
    this.slowConnectionDetected = false;
  }

  async acquireUploadSlot() {
    while (this.uploading >= this.max) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.uploading++;
  }

  releaseUploadSlot() {
    this.uploading--;
    const resolve = this.queue.shift();
    if (resolve) resolve();
  }

  getAdaptiveTimeout() {
    if (this.recentUploadTimes.length < 3) {
      return this.baseTimeout;
    }

    const last5 = this.recentUploadTimes.slice(-5);
    const avg = last5.reduce((a, b) => a + b, 0) / last5.length;

    return Math.max(this.baseTimeout, Math.min(avg * 2, 60000));
  }

  recordUploadTime(durationMs) {
    this.recentUploadTimes.push(durationMs);

    if (this.recentUploadTimes.length > 10) {
      this.recentUploadTimes.shift();
    }

    if (this.recentUploadTimes.length >= 3) {
      const avg = this.recentUploadTimes.slice(-3).reduce((a, b) => a + b, 0) / 3;

      if (avg > 20000 && !this.slowConnectionDetected) {
        console.log('\n⚠️  Slow connection detected, reducing upload concurrency');
        this.slowConnectionDetected = true;
        this.max = this.fallbackConcurrency;
      } else if (avg < 15000 && this.slowConnectionDetected) {
        console.log('\n✅ Connection improved, restoring upload concurrency');
        this.slowConnectionDetected = false;
        this.max = this.fallbackConcurrency + 1;
      }
    }
  }

  async wrapFetch(url, options) {
    await this.acquireUploadSlot();

    const startTime = Date.now();
    const timeout = this.getAdaptiveTimeout();

    let slotReleased = false;

    const uploadTimeoutHandle = setTimeout(() => {
      if (!slotReleased) {
        slotReleased = true;
        this.releaseUploadSlot();
        this.totalUploads++;
      }
    }, timeout);

    try {
      const response = await fetch(url, options);

      const uploadDuration = Date.now() - startTime;

      clearTimeout(uploadTimeoutHandle);

      if (!slotReleased) {
        slotReleased = true;
        this.releaseUploadSlot();
        this.totalUploads++;
      }

      this.recordUploadTime(Math.min(uploadDuration, timeout));

      return response;
    } catch (error) {
      clearTimeout(uploadTimeoutHandle);

      if (!slotReleased) {
        slotReleased = true;
        this.releaseUploadSlot();
        this.totalUploads++;
      }

      throw error;
    }
  }

  getStats() {
    return {
      uploading: this.uploading,
      queued: this.queue.length,
      totalUploads: this.totalUploads,
      avgUploadTime: this.recentUploadTimes.length > 0
        ? Math.round(this.recentUploadTimes.reduce((a, b) => a + b, 0) / this.recentUploadTimes.length)
        : 0,
      maxUpload: this.max,
      slowConnection: this.slowConnectionDetected
    };
  }
}

// ============================================================================
// SIMPLE CIRCUIT BREAKER
// ============================================================================

class SimpleCircuitBreaker {
  constructor(threshold = 5, cooldownMs = 60000) {
    this.failures = 0;
    this.lastFailure = null;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.totalBreaks = 0;
  }

  canProceed() {
    if (this.failures < this.threshold) return true;

    const timeSinceFailure = Date.now() - this.lastFailure;
    if (timeSinceFailure > this.cooldownMs) {
      console.log('✅ Circuit breaker: Cooldown period elapsed, resetting...');
      this.failures = 0;
      return true;
    }

    return false;
  }

  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.totalBreaks++;
      console.log(`\n⚠️  Circuit breaker: ${this.failures} consecutive failures, pausing for ${this.cooldownMs / 1000}s`);
    }
  }

  recordSuccess() {
    if (this.failures > 0) {
      this.failures = 0;
    }
  }

  getStats() {
    return {
      failures: this.failures,
      isOpen: this.failures >= this.threshold,
      totalBreaks: this.totalBreaks
    };
  }
}

// ============================================================================
// PROGRESS TRACKER
// ============================================================================

class ProgressTracker {
  constructor() {
    this.totalPrompts = 0;
    this.processedPrompts = 0;
    this.successCount = 0;
    this.failCount = 0;
    this.startTime = Date.now();
    this.lastUpdate = 0;
  }

  setTotal(total) {
    this.totalPrompts = total;
  }

  increment(success = true) {
    this.processedPrompts++;
    if (success) {
      this.successCount++;
    } else {
      this.failCount++;
    }

    this.maybeShowProgress();
  }

  maybeShowProgress() {
    const now = Date.now();

    if (now - this.lastUpdate < 2000 && this.processedPrompts < this.totalPrompts) {
      return;
    }

    this.lastUpdate = now;
    this.showProgress();
  }

  showProgress() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const percentage = this.totalPrompts > 0 ? Math.round((this.processedPrompts / this.totalPrompts) * 100) : 0;
    const rate = this.processedPrompts / elapsed;
    const remaining = this.totalPrompts - this.processedPrompts;
    const eta = remaining > 0 && rate > 0 ? Math.round(remaining / rate) : 0;

    const progressBar = this.makeProgressBar(percentage, 30);

    console.log(`\n[${progressBar}] ${percentage}%`);
    console.log(`   Processed: ${this.processedPrompts}/${this.totalPrompts} prompts`);
    console.log(`   Success: ${this.successCount} | Failed: ${this.failCount}`);
    console.log(`   Rate: ${rate.toFixed(2)} prompts/sec`);
    if (eta > 0) {
      console.log(`   ETA: ${this.formatDuration(eta)}`);
    }
  }

  makeProgressBar(percentage, width) {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '='.repeat(filled) + '-'.repeat(empty);
  }

  formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  }

  showFinalSummary() {
    const elapsed = (Date.now() - this.startTime) / 1000;

    console.log('\n' + '='.repeat(60));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total prompts: ${this.processedPrompts}`);
    console.log(`Success: ${this.successCount} (${Math.round((this.successCount / this.processedPrompts) * 100)}%)`);
    console.log(`Failed: ${this.failCount} (${Math.round((this.failCount / this.processedPrompts) * 100)}%)`);
    console.log(`Total time: ${this.formatDuration(Math.round(elapsed))}`);
    console.log(`Average rate: ${(this.processedPrompts / elapsed).toFixed(2)} prompts/sec`);
    console.log('='.repeat(60));
  }
}

const progressTracker = new ProgressTracker();

// Global limiters
let geminiLimiter = null;
let concurrencyLimiter = null;
let uploadLimiter = null;
let circuitBreaker = null;
let maxConcurrent = 2; // FAL.ai hard limit

// ============================================================================
// FAL.AI SEEDREAM API
// ============================================================================

class FalSeedreamAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  getName() {
    return 'FAL.ai Seedream';
  }

  async generate(config) {
    const { prompt, refImageUrls, numImages, enableNSFW, size } = config;

    console.log(`[FAL] Generating ${numImages} images...`);

    // Parse size
    const [width, height] = size.split('x').map(Number);

    const requestBody = {
      prompt: prompt,
      image_urls: refImageUrls,
      num_images: numImages,
      image_size: { width, height },
      enable_safety_checker: !enableNSFW
    };

    // Calculate payload size
    const payloadSizeKB = Math.round(JSON.stringify(requestBody).length / 1024);
    console.log(`[FAL] Uploading ${payloadSizeKB}KB payload...`);

    // Use upload limiter if available
    const fetchFn = uploadLimiter
      ? () => uploadLimiter.wrapFetch(
          'https://fal.run/fal-ai/bytedance/seedream/v4/edit',
          {
            method: 'POST',
            headers: {
              'Authorization': `Key ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            agent: httpsAgent,
            signal: AbortSignal.timeout(300000)
          }
        )
      : () => fetch(
          'https://fal.run/fal-ai/bytedance/seedream/v4/edit',
          {
            method: 'POST',
            headers: {
              'Authorization': `Key ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            agent: httpsAgent,
            signal: AbortSignal.timeout(300000)
          }
        );

    const response = await fetchFn();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FAL API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const images = result.images || [];

    if (images.length === 0) {
      throw new Error('FAL returned no images');
    }

    console.log(`[FAL] ✅ Generated ${images.length} images`);
    return images;
  }

  async generateVideo(config) {
    const { imageUrl, prompt, duration, cfgScale } = config;

    console.log(`[FAL Video] Generating video...`);

    const response = await fetch(
      'https://fal.run/fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      {
        method: 'POST',
        headers: {
          'Authorization': `Key ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: prompt,
          duration: duration.toString(),
          cfg_scale: cfgScale || 0.5,
          negative_prompt: "blur, distort, low quality"
        }),
        agent: httpsAgent
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FAL Video API error ${response.status}: ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const videoUrl = result.video?.url;

    if (!videoUrl) {
      throw new Error('FAL returned no video URL');
    }

    console.log(`[FAL Video] ✅ Generated video`);
    return { url: videoUrl };
  }
}

// ============================================================================
// GEMINI IMAGE ANALYSIS
// ============================================================================

async function analyzeImageWithGemini(imageUrl, promptTemplate, geminiApiKey) {
  console.log('  🔍 Analyzing image with Gemini...');

  // Download image
  const imgResp = await fetch(imageUrl, { agent: imageUrl.startsWith('https') ? httpsAgent : httpAgent });
  if (!imgResp.ok) {
    throw new Error(`Failed to download image: ${imgResp.status}`);
  }

  const imgBuffer = await imgResp.arrayBuffer();
  const imgBytes = new Uint8Array(imgBuffer);
  const base64Image = arrayToBase64(imgBytes);
  const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';

  // Call Gemini API
  const geminiResp = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': geminiApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image
              }
            },
            {
              text: promptTemplate
            }
          ]
        }]
      }),
      agent: httpsAgent
    }
  );

  if (!geminiResp.ok) {
    const errorText = await geminiResp.text();
    throw new Error(`Gemini API error ${geminiResp.status}: ${errorText.substring(0, 200)}`);
  }

  const geminiData = await geminiResp.json();
  const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!generatedText) {
    throw new Error('Gemini returned no text');
  }

  console.log(`  ✅ Gemini response: "${generatedText.substring(0, 100)}..."`);

  return {
    text: generatedText,
    imageBuffer: imgBuffer,
    mimeType: mimeType
  };
}

// ============================================================================
// AIRTABLE HELPERS
// ============================================================================

async function updateAirtableRecord(recordId, fields) {
  const response = await fetch(
    `https://api.airtable.com/v0/${CONFIG.airtable.baseId}/Generation/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${CONFIG.airtable.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields }),
      agent: httpsAgent,
      signal: AbortSignal.timeout(300000)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Airtable update failed: ${response.status} - ${errorText.substring(0, 100)}`);
  }

  return await response.json();
}

// ============================================================================
// DOWNLOAD IMAGES TO LOCAL FOLDER
// ============================================================================

async function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }

      const fileStream = createWriteStream(filepath);
      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

// ============================================================================
// MAIN BATCH PROCESSING
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('LADIES MANAGER - BATCH PROCESSOR (VPS)');
  console.log('='.repeat(60) + '\n');

  // Load configuration from Airtable
  console.log('📥 Loading configuration from Airtable...');

  const configResp = await fetch(
    `https://api.airtable.com/v0/${CONFIG.airtable.baseId}/Configuration?maxRecords=1`,
    {
      headers: { 'Authorization': `Bearer ${CONFIG.airtable.token}` },
      agent: httpsAgent,
      signal: AbortSignal.timeout(300000)
    }
  );

  if (!configResp.ok) {
    const errorData = await configResp.json();
    throw new Error(`Airtable config error: ${configResp.status} - ${JSON.stringify(errorData)}`);
  }

  const configData = await configResp.json();
  const airtableConfig = configData.records?.[0]?.fields;

  if (!airtableConfig) {
    throw new Error('No configuration record found in Airtable');
  }

  // Extract settings
  const enableNSFW = airtableConfig.Enable_NSFW || false;
  const imageSize = airtableConfig.Image_Size || '2048x2048';

  let numImages = airtableConfig.num_images || 6;
  if (typeof numImages !== 'number' || numImages < 1 || numImages > 6) {
    console.warn(`⚠️ Invalid num_images value: ${numImages}, using default: 6`);
    numImages = 6;
  }

  const enableVideo = airtableConfig.Enable_Video || false;
  let videoDuration = airtableConfig.Video_Duration || 5;
  if (![5, 10].includes(videoDuration)) {
    console.warn(`⚠️ Invalid Video_Duration: ${videoDuration}, using default: 5`);
    videoDuration = 5;
  }

  const geminiApiKey = airtableConfig.Gemini_API_Key;
  const geminiPromptTemplate = airtableConfig.Gemini_Prompt_Template || 'Describe this image in detail for AI art generation';

  console.log(`  Provider: FAL.ai Seedream`);
  console.log(`  Images per prompt: ${numImages}`);
  console.log(`  NSFW: ${enableNSFW ? 'enabled' : 'disabled'}`);
  console.log(`  Size: ${imageSize}`);
  console.log(`  Video: ${enableVideo ? 'enabled' : 'disabled'}${enableVideo ? ` (${videoDuration}s)` : ''}`);
  console.log(`  Gemini: ${geminiApiKey ? 'enabled' : 'disabled'}`);

  const apiKey = airtableConfig.FAL_API_KEY;
  if (!apiKey) {
    throw new Error('FAL_API_KEY not found in Airtable Configuration');
  }

  // Initialize limiters
  if (geminiApiKey) {
    geminiLimiter = new RateLimiter(10); // Free tier
    console.log('  ✅ Gemini rate limiter: free tier (10 RPM)');
  }

  maxConcurrent = 2; // FAL.ai hard limit
  concurrencyLimiter = new ConcurrencyLimiter(maxConcurrent);
  console.log(`  ✅ Concurrency limiter: ${maxConcurrent} max concurrent`);

  uploadLimiter = new UploadLimiter(3, 10000, 2);
  console.log('  ✅ Upload limiter: 3 max concurrent uploads');

  circuitBreaker = new SimpleCircuitBreaker(5, 60000);
  console.log('  ✅ Circuit breaker: 5 failure threshold\n');

  // Initialize API
  const api = new FalSeedreamAPI(apiKey);
  console.log(`✅ Using ${api.getName()}\n`);

  // Load reference images
  const faceReference = airtableConfig.Face_Reference || [];
  const bodyReference = airtableConfig.Body_Reference || [];

  if (faceReference.length === 0 && bodyReference.length === 0) {
    throw new Error('No Face_Reference or Body_Reference found in Airtable configuration');
  }

  const faceImages = faceReference.slice(0, 2);
  const bodyImages = bodyReference.slice(0, 2);

  console.log(`  Face reference: ${faceImages.length} images`);
  console.log(`  Body reference: ${bodyImages.length} images`);

  const baseReferenceImages = [...faceImages, ...bodyImages];

  // Prepare base reference images
  console.log('↓ Preparing base reference images (Face + Body)...');

  const baseRefImageUrls = [];

  for (let i = 0; i < baseReferenceImages.length; i++) {
    const attachment = baseReferenceImages[i];
    const imageUrl = attachment.url;
    const imageType = i < faceImages.length ? 'Face' : 'Body';

    console.log(`  Converting ${imageType} image ${i + 1} to data URI...`);
    const imgResp = await fetch(imageUrl, { agent: httpsAgent });
    if (!imgResp.ok) {
      throw new Error(`Failed to download ${imageType} reference image ${i + 1}`);
    }

    const imgBuffer = await imgResp.arrayBuffer();
    const imgBytes = new Uint8Array(imgBuffer);
    const base64 = arrayToBase64(imgBytes);
    const mimeType = imgResp.headers.get('content-type') || 'image/png';
    const dataUri = `data:${mimeType};base64,${base64}`;

    baseRefImageUrls.push(dataUri);
  }

  console.log(`✅ Prepared ${baseRefImageUrls.length} base reference images\n`);

  // Create downloads directory
  const downloadsDir = join(__dirname, 'downloads');
  if (!existsSync(downloadsDir)) {
    mkdirSync(downloadsDir, { recursive: true });
    console.log(`✅ Created downloads directory: ${downloadsDir}\n`);
  }

  // Main processing loop
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;

  const batchSize = 100;

  while (true) {
    console.log(`\n=== Fetching next batch (max ${batchSize}) ===\n`);

    const filter = enableVideo
      ? `OR({Generated Images}=BLANK(), AND(NOT({Generated Images}=BLANK()), {Generated_Videos}=BLANK()))`
      : `{Generated Images}=BLANK()`;

    const promptResp = await fetch(
      `https://api.airtable.com/v0/${CONFIG.airtable.baseId}/Generation?` +
      `filterByFormula=${encodeURIComponent(filter)}&` +
      `fields[]=Prompt&fields[]=Video_Prompt&fields[]=Generated Images&fields[]=Prompt_Image&maxRecords=${batchSize}`,
      {
        headers: { 'Authorization': `Bearer ${CONFIG.airtable.token}` },
        agent: httpsAgent,
        signal: AbortSignal.timeout(300000)
      }
    );

    if (!promptResp.ok) {
      throw new Error(`Failed to fetch prompts: ${promptResp.status}`);
    }

    const promptData = await promptResp.json();
    const prompts = promptData.records || [];

    if (prompts.length === 0) {
      console.log('✅ No more prompts to process');
      break;
    }

    console.log(`📋 Processing ${prompts.length} prompts...\n`);
    progressTracker.setTotal(prompts.length);

    const genConfig = {
      numImages,
      imageSize,
      enableNSFW,
      enableVideo,
      videoDuration,
      geminiApiKey,
      geminiPromptTemplate,
      downloadsDir
    };

    const results = await Promise.all(
      prompts.map(promptRecord => concurrencyLimiter.run(async () => {
        return await processPrompt(promptRecord, baseRefImageUrls, api, genConfig);
      }))
    );

    const batchSuccess = results.filter(r => r.success).length;
    const batchFailed = results.filter(r => !r.success).length;

    totalProcessed += prompts.length;
    totalSuccess += batchSuccess;
    totalFailed += batchFailed;

    console.log(`\n✅ Batch complete: ${batchSuccess} succeeded, ${batchFailed} failed`);

    if (prompts.length < batchSize) {
      break;
    }
  }

  progressTracker.showFinalSummary();

  if (totalProcessed === 0) {
    console.log('\n✅ All prompts already processed!');
  } else {
    console.log(`\n✅ Processing complete!`);
    console.log(`   Total: ${totalProcessed} prompts`);
    console.log(`   Success: ${totalSuccess}`);
    console.log(`   Failed: ${totalFailed}`);
    console.log(`   Downloads: ${downloadsDir}`);
  }
}

// ============================================================================
// PROCESS SINGLE PROMPT
// ============================================================================

async function processPrompt(promptRecord, baseRefImageUrls, api, genConfig) {
  const promptId = promptRecord.id;
  let promptText = promptRecord.fields.Prompt;
  let videoPromptText = promptRecord.fields.Video_Prompt || promptText;
  const existingImages = promptRecord.fields['Generated Images'];
  const promptImageAttachment = promptRecord.fields.Prompt_Image;

  const { numImages, imageSize, enableNSFW, enableVideo, videoDuration, geminiApiKey, geminiPromptTemplate, downloadsDir } = genConfig;

  if (circuitBreaker && !circuitBreaker.canProceed()) {
    console.log(`⏸️  [${promptId}] Circuit breaker open, skipping...`);
    return { success: false, promptId, error: 'Circuit breaker open', skipErrorSave: true };
  }

  try {
    console.log(`\n↓ [${promptId}] "${promptText?.substring(0, 60) || 'No prompt'}..."`);

    let images;

    if (existingImages && existingImages.length > 0) {
      console.log(`⭕ [${promptId}] Images already exist, skipping generation`);
      images = existingImages.map(img => ({ url: img.url }));
    } else {
      let finalRefImageUrls = [...baseRefImageUrls];

      let cachedImageBuffer = null;
      let cachedImageMimeType = null;

      if (promptImageAttachment && promptImageAttachment.length > 0) {
        const promptImageUrl = promptImageAttachment[0].url;
        console.log(`↓ [${promptId}] Prompt_Image detected`);

        if (geminiApiKey) {
          console.log(`↓ [${promptId}] Analyzing with Gemini...`);

          await geminiLimiter.acquire();

          const geminiResult = await analyzeImageWithGemini(
            promptImageUrl,
            geminiPromptTemplate,
            geminiApiKey
          );

          await updateAirtableRecord(promptId, {
            'Prompt': geminiResult.text
          });

          promptText = geminiResult.text;
          if (!promptRecord.fields.Video_Prompt) {
            videoPromptText = geminiResult.text;
          }
          console.log(`✅ [${promptId}] Prompt updated from Gemini`);

          cachedImageBuffer = geminiResult.imageBuffer;
          cachedImageMimeType = geminiResult.mimeType;
        }

        console.log(`↓ [${promptId}] Adding Prompt_Image as 5th reference...`);
        if (cachedImageBuffer) {
          const imgBytes = new Uint8Array(cachedImageBuffer);
          const base64 = arrayToBase64(imgBytes);
          const dataUri = `data:${cachedImageMimeType};base64,${base64}`;
          finalRefImageUrls.push(dataUri);
        } else {
          const imgResp = await fetch(promptImageUrl, { agent: httpsAgent });
          if (imgResp.ok) {
            const imgBuffer = await imgResp.arrayBuffer();
            const imgBytes = new Uint8Array(imgBuffer);
            const base64 = arrayToBase64(imgBytes);
            const mimeType = imgResp.headers.get('content-type') || 'image/png';
            const dataUri = `data:${mimeType};base64,${base64}`;
            finalRefImageUrls.push(dataUri);
          }
        }
        console.log(`✅ [${promptId}] Total reference images: ${finalRefImageUrls.length}`);
      } else {
        console.log(`  [${promptId}] No Prompt_Image, using ${finalRefImageUrls.length} base references`);
      }

      // Generate images
      console.log(`\n↓ [${promptId}] Generating ${numImages} images...`);

      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`   [${promptId}] Retry attempt ${attempt}/3...`);
          }

          images = await api.generate({
            prompt: promptText,
            refImageUrls: finalRefImageUrls,
            numImages: numImages,
            enableNSFW: enableNSFW,
            size: imageSize
          });

          break;

        } catch (error) {
          lastError = error;

          const errorMsg = error.message.toLowerCase();
          const is524 = error.message.includes('524');
          const isTimeout = errorMsg.includes('timeout');
          const is5xxError = error.message.includes('502') ||
                            error.message.includes('503') ||
                            error.message.includes('504');

          const isRetryable = is524 || isTimeout || is5xxError;

          if (isRetryable && attempt < 3) {
            const backoffDelay = [1000, 2000, 4000][attempt - 1];
            console.log(`   ⚠️ [${promptId}] ${error.message} - waiting ${backoffDelay}ms before retry...`);
            await sleep(backoffDelay);
            continue;
          }

          throw error;
        }
      }

      if (!images) {
        throw lastError || new Error('Failed to generate images after 3 attempts');
      }

      // Download images locally
      console.log(`↓ [${promptId}] Downloading ${images.length} images...`);
      for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i].url;
        const extension = 'png';
        const filename = `${promptId}_${i + 1}.${extension}`;
        const filepath = join(downloadsDir, filename);

        try {
          await downloadImage(imageUrl, filepath);
          console.log(`  ✅ Downloaded: ${filename}`);
        } catch (err) {
          console.log(`  ⚠️ Failed to download ${filename}: ${err.message}`);
        }
      }

      // Save to Airtable
      await updateAirtableRecord(promptId, {
        'Generated Images': images.map(img => ({ url: img.url })),
        'Error Message': null
      });

      console.log(`✅ [${promptId}] Saved ${images.length} images`);
    }

    // Generate videos
    if (enableVideo) {
      console.log(`↓ [${promptId}] Generating 1 video from first image...`);

      try {
        let video;
        let lastVideoError;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if (attempt > 1) {
              console.log(`   [${promptId}] Video retry attempt ${attempt}/2...`);
            }

            video = await api.generateVideo({
              imageUrl: images[0].url,
              prompt: videoPromptText,
              duration: videoDuration,
              cfgScale: 0.5
            });

            break;

          } catch (error) {
            lastVideoError = error;
            const is524 = error.message.includes('524');
            const isTimeout = error.message.toLowerCase().includes('timeout');

            if ((is524 || isTimeout) && attempt < 2) {
              console.log(`   ⚠️ [${promptId}] Video ${error.message} - retrying...`);
              await sleep(5000);
              continue;
            }

            throw error;
          }
        }

        if (!video) {
          throw lastVideoError || new Error('Failed to generate video after 2 attempts');
        }

        // Download video locally
        const videoFilename = `${promptId}_video.mp4`;
        const videoFilepath = join(downloadsDir, videoFilename);
        try {
          await downloadImage(video.url, videoFilepath);
          console.log(`  ✅ Downloaded video: ${videoFilename}`);
        } catch (err) {
          console.log(`  ⚠️ Failed to download video: ${err.message}`);
        }

        await updateAirtableRecord(promptId, {
          'Generated_Videos': [{ url: video.url }]
        });

        console.log(`✅ [${promptId}] Saved 1 video`);

      } catch (videoError) {
        const errorMsg = `Video generation failed: ${videoError.message}`;
        await updateAirtableRecord(promptId, {
          'Error Message': errorMsg
        });
        console.error(`❌ [${promptId}] ${errorMsg}`);
      }
    } else {
      console.log(`⭕ [${promptId}] Video generation disabled`);
    }

    progressTracker.increment(true);

    if (circuitBreaker) {
      circuitBreaker.recordSuccess();
    }

    return {
      success: true,
      promptId,
      imageCount: images.length
    };

  } catch (error) {
    const errorMsg = error.message.toLowerCase();
    const is524 = error.message.includes('524');
    const isTimeout = errorMsg.includes('timeout');
    const isTooManySubrequests = errorMsg.includes('too many subrequests');
    const is5xxError = error.message.includes('502') ||
                      error.message.includes('503') ||
                      error.message.includes('504');

    const isTransient = is524 || isTimeout || isTooManySubrequests || is5xxError;

    if (isTransient) {
      console.log(`↩ [${promptId}] Transient error (${error.message}) - will retry in next batch`);
      progressTracker.increment(false);
      return { success: false, promptId, error: error.message, skipErrorSave: true };
    }

    console.error(`❌ [${promptId}] Error: ${error.message}`);

    if (circuitBreaker) {
      circuitBreaker.recordFailure();
    }

    try {
      await updateAirtableRecord(promptId, {
        'Error Message': error.message.substring(0, 200)
      });
    } catch (e) {
      console.error(`Failed to save error for ${promptId}:`, e);
    }

    progressTracker.increment(false);
    return { success: false, promptId, error: error.message };
  }
}

// ============================================================================
// RUN
// ============================================================================

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
