/**
 * Enhanced Logging System
 * Author: IRFAN
 * Version: 2.0.0
 */

const winston = require('winston');
const moment = require('moment-timezone');
const config = require('../config.json');

// Custom log format with colors
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: () => moment().tz(config.bot.timezone).format('YYYY-MM-DD HH:mm:ss')
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// Colorize console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  customFormat
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level || 'info',
  format: customFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

// Add file transport if enabled
if (config.logging.logToFile) {
  const fs = require('fs');
  const path = require('path');
  const logsDir = path.join(__dirname, '../logs');
  
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'bot.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true,
    format: customFormat,
  }));
  
  // Error log file
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    maxsize: 5242880,
    maxFiles: 5,
    tailable: true,
    format: customFormat,
  }));
}

// Helper methods
logger.botStart = function() {
  this.info('🤖 Starting Next-Gen Facebook Page Bot...');
  this.info(`📄 Page: ${config.facebook.pageId}`);
  this.info(`🕐 Timezone: ${config.bot.timezone}`);
  this.info(`🔧 Prefix: ${config.bot.prefix}`);
};

logger.botReady = function() {
  this.info('✅ Bot is ready and listening for events');
};

logger.messageReceived = function(senderId, message) {
  this.info(`📩 Message from ${senderId}: ${message.substring(0, 100)}`);
};

logger.commentReceived = function(senderName, message) {
  this.info(`💬 Comment from ${senderName}: ${message.substring(0, 100)}`);
};

logger.postbackReceived = function(senderId, payload) {
  this.info(`🔘 Postback from ${senderId}: ${JSON.stringify(payload)}`);
};

logger.pluginLoaded = function(type, name) {
  this.debug(`✅ Loaded ${type} plugin: ${name}`);
};

logger.pluginError = function(name, error) {
  this.error(`❌ Plugin ${name} error:`, error);
};

logger.apiCall = function(endpoint, method) {
  this.debug(`🌐 API ${method} ${endpoint}`);
};

logger.apiError = function(endpoint, error) {
  this.error(`🌐 API Error at ${endpoint}:`, error.message);
};

module.exports = logger;
