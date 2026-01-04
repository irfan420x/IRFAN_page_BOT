/**
 * Message and Postback Tracking System
 * Prevents duplicate processing and tracks daily counters
 * Author: IRFAN
 * Version: 2.0.0
 */

const moment = require('moment-timezone');
const config = require('../config.json');

class MessageTracker {
  constructor() {
    this.messageHistory = new Map();
    this.commentHistory = new Map();
    this.postbackHistory = new Map();
    this.dailyCounts = {
      messages: 0,
      comments: 0,
      postbacks: 0,
      duplicates: 0,
    };
    this.lastReset = moment().tz(config.bot.timezone).format('YYYY-MM-DD');
  }

  // Check for duplicate message
  isDuplicate(senderId, timestamp, type = 'message') {
    const key = `${senderId}_${timestamp}`;
    
    // Check if we've processed this already
    if (this.messageHistory.has(key)) {
      this.dailyCounts.duplicates++;
      return true;
    }
    
    // Clean old entries (older than 5 minutes)
    this.cleanOldEntries();
    
    // Add to history with expiration
    this.messageHistory.set(key, {
      timestamp: Date.now(),
      type,
      expiresAt: Date.now() + 300000, // 5 minutes
    });
    
    return false;
  }

  // Check for duplicate comment
  isDuplicateComment(commentId) {
    if (this.commentHistory.has(commentId)) {
      this.dailyCounts.duplicates++;
      return true;
    }
    
    this.commentHistory.set(commentId, {
      timestamp: Date.now(),
      expiresAt: Date.now() + 300000, // 5 minutes
    });
    
    return false;
  }

  // Check for duplicate postback
  isDuplicatePostback(senderId, payload, timestamp) {
    const key = `${senderId}_${JSON.stringify(payload)}_${timestamp}`;
    
    if (this.postbackHistory.has(key)) {
      this.dailyCounts.duplicates++;
      return true;
    }
    
    this.postbackHistory.set(key, {
      timestamp: Date.now(),
      expiresAt: Date.now() + 300000, // 5 minutes
    });
    
    return false;
  }

  // Track message
  track(senderId, timestamp, type = 'message') {
    this.checkDailyReset();
    
    switch (type) {
      case 'message':
        this.dailyCounts.messages++;
        break;
      case 'comment':
        this.dailyCounts.comments++;
        break;
      case 'postback':
        this.dailyCounts.postbacks++;
        break;
    }
  }

  // Track comment
  trackComment(commentId) {
    this.checkDailyReset();
    this.dailyCounts.comments++;
  }

  // Track postback
  trackPostback(senderId, payload) {
    this.checkDailyReset();
    this.dailyCounts.postbacks++;
  }

  // Clean old entries
  cleanOldEntries() {
    const now = Date.now();
    
    // Clean message history
    for (const [key, data] of this.messageHistory.entries()) {
      if (data.expiresAt < now) {
        this.messageHistory.delete(key);
      }
    }
    
    // Clean comment history
    for (const [key, data] of this.commentHistory.entries()) {
      if (data.expiresAt < now) {
        this.commentHistory.delete(key);
      }
    }
    
    // Clean postback history
    for (const [key, data] of this.postbackHistory.entries()) {
      if (data.expiresAt < now) {
        this.postbackHistory.delete(key);
      }
    }
  }

  // Check and reset daily counters
  checkDailyReset() {
    const today = moment().tz(config.bot.timezone).format('YYYY-MM-DD');
    
    if (today !== this.lastReset) {
      this.resetDailyCounters();
      this.lastReset = today;
    }
  }

  // Reset daily counters
  resetDailyCounters() {
    this.dailyCounts = {
      messages: 0,
      comments: 0,
      postbacks: 0,
      duplicates: 0,
    };
  }

  // Get today's message count
  getTodayCount() {
    return this.dailyCounts.messages;
  }

  // Get today's comment count
  getTodayCommentCount() {
    return this.dailyCounts.comments;
  }

  // Get today's postback count
  getTodayPostbackCount() {
    return this.dailyCounts.postbacks;
  }

  // Get duplicate count
  getDuplicateCount() {
    return this.dailyCounts.duplicates;
  }

  // Get all stats
  getStats() {
    return {
      ...this.dailyCounts,
      uniqueMessages: this.messageHistory.size,
      uniqueComments: this.commentHistory.size,
      uniquePostbacks: this.postbackHistory.size,
      lastReset: this.lastReset,
    };
  }
}

class PostbackTracker {
  constructor() {
    this.postbacks = new Map();
    this.cooldowns = new Map();
  }

  // Check if postback is in cooldown
  isInCooldown(userId, payload, cooldownMs = 1000) {
    const key = `${userId}_${JSON.stringify(payload)}`;
    
    if (this.cooldowns.has(key)) {
      const lastTime = this.cooldowns.get(key);
      if (Date.now() - lastTime < cooldownMs) {
        return true;
      }
    }
    
    this.cooldowns.set(key, Date.now());
    return false;
  }

  // Clean old cooldowns
  cleanOldCooldowns(maxAgeMs = 60000) {
    const now = Date.now();
    for (const [key, timestamp] of this.cooldowns.entries()) {
      if (now - timestamp > maxAgeMs) {
        this.cooldowns.delete(key);
      }
    }
  }
}

module.exports = {
  MessageTracker,
  PostbackTracker,
};