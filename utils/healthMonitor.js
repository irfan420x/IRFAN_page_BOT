/**
 * Health Monitoring System
 * Tracks bot health and performance metrics
 * Author: IRFAN
 * Version: 2.0.0
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class HealthMonitor {
  constructor() {
    this.metrics = {
      startTime: Date.now(),
      requests: 0,
      errors: 0,
      warnings: 0,
      lastCheck: null,
      consecutiveFailures: 0,
    };
    
    this.thresholds = {
      memoryUsage: 0.9, // 90%
      cpuUsage: 0.8,    // 80%
      diskUsage: 0.85,  // 85%
      errorRate: 0.1,   // 10%
    };
    
    this.healthChecks = [];
  }

  // Register health check
  registerHealthCheck(name, checkFn, intervalMs = 60000) {
    this.healthChecks.push({
      name,
      checkFn,
      intervalMs,
      lastRun: 0,
      status: 'unknown',
      lastResult: null,
    });
    
    logger.info(`Registered health check: ${name}`);
  }

  // Run all health checks
  async runHealthChecks() {
    const results = [];
    
    for (const check of this.healthChecks) {
      if (Date.now() - check.lastRun < check.intervalMs) {
        continue;
      }
      
      try {
        const result = await check.checkFn();
        check.status = 'healthy';
        check.lastResult = result;
        check.lastRun = Date.now();
        
        results.push({
          name: check.name,
          status: 'healthy',
          result,
        });
      } catch (error) {
        check.status = 'unhealthy';
        check.lastResult = error.message;
        check.lastRun = Date.now();
        
        results.push({
          name: check.name,
          status: 'unhealthy',
          error: error.message,
        });
        
        logger.warn(`Health check failed: ${check.name} - ${error.message}`);
      }
    }
    
    this.metrics.lastCheck = Date.now();
    return results;
  }

  // Get system metrics
  getSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const systemMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    return {
      process: {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
        },
        cpuUsage: process.cpuUsage(),
      },
      system: {
        memory: {
          total: Math.round(systemMemory / 1024 / 1024),
          free: Math.round(freeMemory / 1024 / 1024),
          used: Math.round((systemMemory - freeMemory) / 1024 / 1024),
          usage: 1 - (freeMemory / systemMemory),
        },
        loadavg: os.loadavg(),
        uptime: os.uptime(),
        cpus: os.cpus().length,
        platform: os.platform(),
        arch: os.arch(),
      },
      bot: {
        uptime: Date.now() - this.metrics.startTime,
        requests: this.metrics.requests,
        errors: this.metrics.errors,
        warnings: this.metrics.warnings,
        errorRate: this.metrics.requests > 0 
          ? this.metrics.errors / this.metrics.requests 
          : 0,
      },
    };
  }

  // Check if system is healthy
  isSystemHealthy() {
    const metrics = this.getSystemMetrics();
    
    // Check memory usage
    if (metrics.process.memory.heapUsed / metrics.process.memory.heapTotal > this.thresholds.memoryUsage) {
      logger.warn(`High memory usage: ${Math.round(metrics.process.memory.heapUsed / metrics.process.memory.heapTotal * 100)}%`);
      return false;
    }
    
    // Check system memory
    if (metrics.system.memory.usage > this.thresholds.memoryUsage) {
      logger.warn(`High system memory usage: ${Math.round(metrics.system.memory.usage * 100)}%`);
      return false;
    }
    
    // Check error rate
    if (metrics.bot.errorRate > this.thresholds.errorRate) {
      logger.warn(`High error rate: ${Math.round(metrics.bot.errorRate * 100)}%`);
      return false;
    }
    
    return true;
  }

  // Increment request count
  incrementRequest() {
    this.metrics.requests++;
  }

  // Increment error count
  incrementError() {
    this.metrics.errors++;
  }

  // Increment warning count
  incrementWarning() {
    this.metrics.warnings++;
  }

  // Get health status
  getHealthStatus() {
    const metrics = this.getSystemMetrics();
    const isHealthy = this.isSystemHealthy();
    const healthChecks = this.healthChecks.map(check => ({
      name: check.name,
      status: check.status,
      lastRun: check.lastRun,
      lastResult: check.lastResult,
    }));
    
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: Date.now(),
      uptime: metrics.bot.uptime,
      system: {
        memory: metrics.system.memory.usage,
        load: metrics.system.loadavg[0],
      },
      process: {
        memory: metrics.process.memory.heapUsed / metrics.process.memory.heapTotal,
      },
      metrics: {
        requests: this.metrics.requests,
        errors: this.metrics.errors,
        warnings: this.metrics.warnings,
        errorRate: metrics.bot.errorRate,
      },
      healthChecks,
    };
  }
}

// Create singleton instance
const healthMonitor = new HealthMonitor();

// Setup default health checks
function setupHealthChecks() {
  // Facebook API health check
  healthMonitor.registerHealthCheck('facebook_api', async () => {
    const fbApi = require('./fbApi');
    const pageInfo = await fbApi.getPageInfo();
    return { pageId: pageInfo.id, pageName: pageInfo.name };
  }, 300000); // 5 minutes
  
  // Plugin system health check
  healthMonitor.registerHealthCheck('plugin_system', async () => {
    const pluginLoader = require('./pluginLoader');
    const stats = pluginLoader.getPluginStats();
    return { total: stats.total, loaded: stats.total > 0 };
  }, 60000); // 1 minute
  
  // Database connection health check (if you add a database)
  healthMonitor.registerHealthCheck('file_system', async () => {
    const fs = require('fs').promises;
    const testFile = path.join(__dirname, '../health_check.txt');
    
    // Test write
    await fs.writeFile(testFile, 'health_check');
    
    // Test read
    const content = await fs.readFile(testFile, 'utf8');
    
    // Cleanup
    await fs.unlink(testFile);
    
    return { write: true, read: content === 'health_check' };
  }, 120000); // 2 minutes
  
  logger.info('✅ Health monitoring system initialized');
}

module.exports = {
  healthMonitor,
  setupHealthChecks,
  getSystemMetrics: () => healthMonitor.getSystemMetrics(),
  getHealthStatus: () => healthMonitor.getHealthStatus(),
  incrementRequest: () => healthMonitor.incrementRequest(),
  incrementError: () => healthMonitor.incrementError(),
  incrementWarning: () => healthMonitor.incrementWarning(),
};
