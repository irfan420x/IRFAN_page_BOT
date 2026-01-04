/**
 * Next-Generation Facebook Page Bot
 * Main Server File
 * Author: IRFAN
 * Version: 2.0.0
 */

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const moment = require('moment-timezone');
const winston = require('winston');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const promClient = require('prom-client');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// Load configuration
const config = require('./config.json');
const fbApi = require('./utils/fbApi');
const { loadPlugins, reloadPlugins, getPluginStats } = require('./utils/pluginLoader');

// NOTE: The handlers directory is named "handlres" (misspelled) in this project.
// Import from the correct path to avoid "Cannot find module" errors that cause
// runtime crashes in serverless deployments.
const { handleMessage, handlePostback, handleComment } = require('./handlres/index');
const { MessageTracker, PostbackTracker } = require('./utils/trackers');
const { setupHealthChecks, getSystemMetrics } = require('./utils/healthMonitor');

// Initialize logging
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => moment().tz(config.bot.timezone).format('YYYY-MM-DD HH:mm:ss')
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Add file transport if enabled
if (config.logging.logToFile) {
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'bot.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true
  }));
}

// Initialize Express app
const app = express();
const PORT = process.env.PORT || config.server.port;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"]
    }
  }
}));
app.use(cors({
  origin: config.security.allowedDomains,
  credentials: true
}));
app.use(compression());
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(bodyParser.urlencoded({ extended: true }));

// Prometheus metrics
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 });
const messageCounter = new promClient.Counter({
  name: 'bot_messages_total',
  help: 'Total messages processed',
  labelNames: ['type', 'status']
});

// Initialize trackers
const messageTracker = new MessageTracker();
const postbackTracker = new PostbackTracker();

// Global state
let botState = {
  startedAt: new Date(),
  uptime: 0,
  messagesProcessed: 0,
  commentsProcessed: 0,
  postbacksProcessed: 0,
  plugins: {
    commands: {},
    postbacks: {},
    comments: {}
  },
  pageInfo: null,
  lastHealthCheck: null,
  isHealthy: true
};

// Load plugins on startup
async function initializeBot() {
  logger.info('🚀 Initializing Next-Gen Facebook Page Bot...');
  logger.info(`📁 Bot Name: ${config.bot.name}`);
  logger.info(`🕐 Timezone: ${config.bot.timezone}`);
  
  try {
    // Load plugins
    botState.plugins = await loadPlugins();
    logger.info(`✅ Loaded ${getPluginStats().total} plugins`);
    
    // Fetch page info
    botState.pageInfo = await fbApi.getPageInfo();
    logger.info(`📄 Page: ${botState.pageInfo.name} (${botState.pageInfo.id})`);
    
    // Setup health checks
    await setupHealthChecks();
    
    // Schedule daily reset
    cron.schedule('0 0 * * *', () => {
      messageTracker.resetDailyCounters();
      logger.info('📊 Daily counters reset');
    });
    
    // Schedule periodic health check
    cron.schedule('*/5 * * * *', async () => {
      await checkBotHealth();
    });
    
    logger.info('✅ Bot initialization complete');
  } catch (error) {
    logger.error('❌ Bot initialization failed:', error);
    process.exit(1);
  }
}

// Request signature verification for Facebook
function verifyRequestSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return;
  }
  
  const expectedSignature = `sha256=${crypto
    .createHmac('sha256', config.facebook.appSecret)
    .update(buf)
    .digest('hex')}`;
  
  if (signature !== expectedSignature) {
    throw new Error('Invalid request signature');
  }
}

// Webhook verification endpoint
app.get(config.server.webhookPath, (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode && token) {
    if (mode === 'subscribe' && token === config.facebook.verifyToken) {
      logger.info('✅ Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      logger.warn('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Webhook event processing endpoint
app.post(config.server.webhookPath, async (req, res) => {
  logger.debug('📨 Webhook received:', req.body);
  
  // Immediately respond to Facebook
  res.status(200).send('EVENT_RECEIVED');
  
  // Process the event asynchronously
  processWebhookEvent(req.body).catch(error => {
    logger.error('Error processing webhook:', error);
  });
});

// Process webhook events
async function processWebhookEvent(body) {
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const pageID = entry.id;
      const timeOfEvent = entry.time;
      
      // Process messaging events
      if (entry.messaging) {
        for (const event of entry.messaging) {
          await processMessagingEvent(event, pageID, timeOfEvent);
        }
      }
      
      // Process feed events (comments)
      if (entry.changes) {
        for (const change of entry.changes) {
          await processFeedEvent(change, pageID, timeOfEvent);
        }
      }
    }
  }
}

// Process messaging events
async function processMessagingEvent(event, pageID, timestamp) {
  try {
    const senderId = event.sender.id;
    const recipientId = event.recipient.id;
    
    // Check for duplicates
    if (messageTracker.isDuplicate(senderId, timestamp)) {
      logger.debug(`⚠️ Duplicate message from ${senderId}, skipping`);
      return;
    }
    
    // Track message
    messageTracker.track(senderId, timestamp);
    botState.messagesProcessed++;
    messageCounter.inc({ type: 'message', status: 'received' });
    
    // Message with text
    if (event.message) {
      await handleMessage(event.message, senderId, recipientId, timestamp);
    }
    // Postback from buttons
    else if (event.postback) {
      await handlePostback(event.postback, senderId, recipientId, timestamp);
    }
    // Message read receipts
    else if (event.read) {
      logger.debug(`📖 Message read by ${senderId}`);
    }
    // Message deliveries
    else if (event.delivery) {
      logger.debug(`✓ Message delivered to ${senderId}`);
    }
    // Other events
    else {
      logger.debug('Other messaging event:', event);
    }
  } catch (error) {
    logger.error('Error processing messaging event:', error);
    messageCounter.inc({ type: 'message', status: 'error' });
  }
}

// Process feed events (comments)
async function processFeedEvent(change, pageID, timestamp) {
  try {
    if (change.field === 'feed' && change.value) {
      const value = change.value;
      
      // New comment on page post
      if (value.item === 'comment' && value.verb === 'add') {
        const commentId = value.comment_id;
        const postId = value.post_id;
        const senderId = value.from.id;
        const senderName = value.from.name;
        const message = value.message || '';
        const createdAt = value.created_time;
        
        // Check for duplicates
        if (messageTracker.isDuplicateComment(commentId)) {
          logger.debug(`⚠️ Duplicate comment ${commentId}, skipping`);
          return;
        }
        
        // Track comment
        messageTracker.trackComment(commentId);
        botState.commentsProcessed++;
        messageCounter.inc({ type: 'comment', status: 'received' });
        
        logger.info(`💬 New comment from ${senderName} (${senderId}): ${message}`);
        
        // Handle comment
        await handleComment({
          commentId,
          postId,
          senderId,
          senderName,
          message,
          createdAt
        }, pageID);
      }
    }
  } catch (error) {
    logger.error('Error processing feed event:', error);
    messageCounter.inc({ type: 'comment', status: 'error' });
  }
}

// Health check endpoint
app.get('/status', (req, res) => {
  botState.uptime = process.uptime();
  
  const status = {
    status: 'online',
    version: config.app.version,
    uptime: Math.floor(botState.uptime),
    startedAt: botState.startedAt,
    timezone: config.bot.timezone,
    botName: config.bot.name,
    metrics: {
      messagesProcessed: botState.messagesProcessed,
      commentsProcessed: botState.commentsProcessed,
      postbacksProcessed: botState.postbacksProcessed,
      messagesToday: messageTracker.getTodayCount(),
      commentsToday: messageTracker.getTodayCommentCount(),
      duplicatesBlocked: messageTracker.getDuplicateCount()
    },
    plugins: getPluginStats(),
    pageInfo: botState.pageInfo,
    system: getSystemMetrics(),
    health: botState.isHealthy ? 'healthy' : 'degraded'
  };
  
  res.json(status);
});

// Insights endpoint
app.get('/insights', async (req, res) => {
  try {
    const metric = req.query.metric || 'page_impressions';
    const period = req.query.period || 'day';
    const since = req.query.since || moment().subtract(7, 'days').unix();
    const until = req.query.until || moment().unix();
    
    const insights = await fbApi.getInsights(metric, period, since, until);
    res.json({ metric, period, since, until, data: insights });
  } catch (error) {
    logger.error('Error fetching insights:', error);
    res.status(500).json({ error: error.message });
  }
});

// Plugin management endpoint (admin only)
app.post('/plugins/reload', (req, res) => {
  const adminId = req.query.adminId;
  
  if (!config.security.adminUIDs.includes(adminId)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  reloadPlugins()
    .then(newPlugins => {
      botState.plugins = newPlugins;
      res.json({ 
        success: true, 
        message: 'Plugins reloaded',
        stats: getPluginStats()
      });
    })
    .catch(error => {
      res.status(500).json({ error: error.message });
    });
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (error) {
    res.status(500).end(error);
  }
});

// Broadcast endpoint (admin only)
app.post('/broadcast', async (req, res) => {
  try {
    const { adminId, message, type = 'text' } = req.body;
    
    if (!config.security.adminUIDs.includes(adminId)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Get all users (in a real implementation, you'd have a database)
    const users = []; // This would come from your database
    
    const results = await Promise.allSettled(
      users.map(user => fbApi.sendMessage(user.id, message, type))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    res.json({
      success: true,
      message: `Broadcast sent to ${users.length} users`,
      stats: { successful, failed }
    });
    
  } catch (error) {
    logger.error('Error in broadcast:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check function
async function checkBotHealth() {
  try {
    botState.lastHealthCheck = new Date();
    
    // Check Facebook API
    const pageInfo = await fbApi.getPageInfo();
    
    // Check plugin system
    const pluginStats = getPluginStats();
    if (pluginStats.total === 0) {
      throw new Error('No plugins loaded');
    }
    
    // Check memory usage
    const memoryUsage = process.memoryUsage();
    if (memoryUsage.heapUsed / memoryUsage.heapTotal > 0.9) {
      logger.warn('⚠️ High memory usage detected');
      botState.isHealthy = false;
    } else {
      botState.isHealthy = true;
    }
    
    logger.debug('✅ Health check passed');
    return true;
  } catch (error) {
    logger.error('❌ Health check failed:', error);
    botState.isHealthy = false;
    return false;
  }
}

// Graceful shutdown
function setupGracefulShutdown() {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  
  signals.forEach(signal => {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      
      // Perform cleanup
      setTimeout(() => {
        logger.info('👋 Bot shut down complete');
        process.exit(0);
      }, 1000);
    });
  });
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    
    if (config.bot.autoRestart) {
      logger.info('Auto-restarting bot...');
      setTimeout(() => {
        process.exit(1);
      }, 5000);
    }
  });
  
  // Handle unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  });
}

// Start the server
async function startServer() {
  try {
    await initializeBot();
    setupGracefulShutdown();
    
    app.listen(PORT, config.server.host, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`🔗 Webhook: http://${config.server.host}:${PORT}${config.server.webhookPath}`);
      logger.info(`📊 Metrics: http://${config.server.host}:${PORT}/metrics`);
      logger.info(`🏥 Health: http://${config.server.host}:${PORT}/status`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the bot
startServer();
