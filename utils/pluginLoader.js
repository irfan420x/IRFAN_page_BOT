/**
 * Advanced Dynamic Plugin Loader with Hot Reload
 * Author: IRFAN
 * Version: 2.0.0
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { exec } = require('child_process');
const util = require('util');
const logger = require('./logger');
const config = require('../config.json');

const execPromise = util.promisify(exec);

class PluginLoader {
  constructor() {
    this.plugins = {
      commands: new Map(),
      postbacks: new Map(),
      comments: new Map(),
    };
    
    this.pluginPaths = {
      commands: path.join(__dirname, '../plugins/commands'),
      postbacks: path.join(__dirname, '../plugins/postbacks'),
      // Fixed typo: use plural `commentsToReply` directory for comment plugins
      // The original path pointed to `commentToReply` which does not exist,
      // causing comment plugins not to load. Using the correct directory name
      // ensures comment-based auto‑reply plugins are discovered.
      comments: path.join(__dirname, '../plugins/commentsToReply'),
    };
    
    this.watchers = {};
    this.duplicates = new Set();
    this.pluginDependencies = new Map();
  }

  // Initialize plugin system
  async initialize() {
    logger.info('🔄 Initializing plugin system...');
    
    // Create plugin directories if they don't exist
    for (const [type, dir] of Object.entries(this.pluginPaths)) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created ${type} plugin directory: ${dir}`);
      }
    }
    
    // Load all plugins
    await this.loadAllPlugins();
    
    // Setup hot reload if enabled
    if (config.pluginDefaults.hotReload) {
      this.setupHotReload();
    }
    
    logger.info('✅ Plugin system initialized');
  }

  // Load all plugins
  async loadAllPlugins() {
    const loadPromises = Object.entries(this.pluginPaths).map(
      ([type, dir]) => this.loadPluginsOfType(type, dir)
    );
    
    await Promise.all(loadPromises);
  }

  // Load plugins of specific type
  async loadPluginsOfType(type, dir) {
    try {
      const files = fs.readdirSync(dir)
        .filter(file => file.endsWith('.js') && !file.startsWith('_'));
      
      logger.info(`📁 Loading ${files.length} ${type} plugins from ${dir}`);
      
      for (const file of files) {
        await this.loadPlugin(path.join(dir, file), type);
      }
    } catch (error) {
      logger.error(`Failed to load ${type} plugins from ${dir}:`, error);
    }
  }

  // Load individual plugin
  async loadPlugin(filePath, type) {
    try {
      // Clear require cache for hot reload
      delete require.cache[require.resolve(filePath)];
      
      const plugin = require(filePath);
      const pluginName = path.basename(filePath, '.js');
      
      // Validate plugin structure
      if (!this.validatePlugin(plugin, type, pluginName)) {
        logger.warn(`Skipping invalid plugin: ${pluginName}`);
        return;
      }
      
      // Check for duplicates
      const duplicateKey = this.getDuplicateKey(plugin, type);
      if (this.duplicates.has(duplicateKey)) {
        logger.warn(`Duplicate ${type} plugin detected: ${duplicateKey}`);
        return;
      }
      
      // Install dependencies if needed
      if (config.pluginDefaults.autoInstallDeps && plugin.dependencies) {
        await this.installDependencies(plugin.dependencies, pluginName);
      }
      
      // Register plugin
      this.registerPlugin(plugin, type, pluginName, filePath);
      
      logger.debug(`✅ Loaded ${type} plugin: ${pluginName}`);
      
    } catch (error) {
      logger.error(`Failed to load plugin ${filePath}:`, error);
    }
  }

  // Validate plugin structure
  validatePlugin(plugin, type, pluginName) {
    switch (type) {
      case 'commands':
        return plugin.config && 
               typeof plugin.config.name === 'string' &&
               typeof plugin.start === 'function';
               
      case 'postbacks':
        return plugin.payload !== undefined &&
               typeof plugin.start === 'function';
               
      case 'comments':
        return typeof plugin.run === 'function';
        
      default:
        return false;
    }
  }

  // Get duplicate detection key
  getDuplicateKey(plugin, type) {
    switch (type) {
      case 'commands':
        const aliases = plugin.config.aliases || [];
        return `${type}:${plugin.config.name}:${aliases.sort().join(',')}`;
        
      case 'postbacks':
        return `${type}:${JSON.stringify(plugin.payload)}`;
        
      case 'comments':
        return `${type}:${plugin.constructor?.name || 'anonymous'}`;
        
      default:
        return `${type}:${JSON.stringify(plugin)}`;
    }
  }

  // Register plugin
  registerPlugin(plugin, type, name, filePath) {
    const pluginWithMeta = {
      ...plugin,
      meta: {
        name,
        filePath,
        loadedAt: new Date(),
        type,
      },
    };
    
    this.plugins[type].set(name, pluginWithMeta);
    this.duplicates.add(this.getDuplicateKey(plugin, type));
  }

  // Install plugin dependencies
  async installDependencies(dependencies, pluginName) {
    try {
      const depArray = Array.isArray(dependencies) 
        ? dependencies 
        : Object.keys(dependencies);
      
      if (depArray.length === 0) return;
      
      logger.info(`📦 Installing dependencies for ${pluginName}: ${depArray.join(', ')}`);
      
      const installCmd = `npm install ${depArray.join(' ')} --no-save`;
      const { stdout, stderr } = await execPromise(installCmd);
      
      if (stderr && !stderr.includes('npm WARN')) {
        logger.warn(`Dependency install warnings for ${pluginName}:`, stderr);
      }
      
      logger.debug(`✅ Dependencies installed for ${pluginName}`);
      
    } catch (error) {
      logger.error(`Failed to install dependencies for ${pluginName}:`, error);
    }
  }

  // Setup hot reload
  setupHotReload() {
    for (const [type, dir] of Object.entries(this.pluginPaths)) {
      const watcher = chokidar.watch(dir, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
      });
      
      watcher
        .on('add', filePath => this.handleFileChange('add', filePath, type))
        .on('change', filePath => this.handleFileChange('change', filePath, type))
        .on('unlink', filePath => this.handleFileChange('unlink', filePath, type));
      
      this.watchers[type] = watcher;
      
      logger.info(`👀 Watching ${type} plugins for changes`);
    }
  }

  // Handle file changes
  async handleFileChange(event, filePath, type) {
    const pluginName = path.basename(filePath, '.js');
    
    logger.info(`🔄 ${event.toUpperCase()} ${type} plugin: ${pluginName}`);
    
    try {
      switch (event) {
        case 'add':
        case 'change':
          await this.loadPlugin(filePath, type);
          break;
          
        case 'unlink':
          this.unloadPlugin(pluginName, type);
          break;
      }
      
      this.logPluginStats();
      
    } catch (error) {
      logger.error(`Error handling ${event} for ${filePath}:`, error);
    }
  }

  // Unload plugin
  unloadPlugin(name, type) {
    if (this.plugins[type].has(name)) {
      const plugin = this.plugins[type].get(name);
      const duplicateKey = this.getDuplicateKey(plugin, type);
      this.duplicates.delete(duplicateKey);
      
      this.plugins[type].delete(name);
      logger.info(`🗑️ Unloaded ${type} plugin: ${name}`);
    }
  }

  // Get plugin by type and name
  getPlugin(type, name) {
    return this.plugins[type].get(name);
  }

  // Get all plugins of type
  getPluginsByType(type) {
    return Array.from(this.plugins[type].values());
  }

  // Get command plugins
  getCommandPlugins() {
    return this.getPluginsByType('commands');
  }

  // Get postback plugins
  getPostbackPlugins() {
    return this.getPluginsByType('postbacks');
  }

  // Get comment plugins
  getCommentPlugins() {
    return this.getPluginsByType('comments');
  }

  // Get plugin statistics
  getStats() {
    return {
      commands: this.plugins.commands.size,
      postbacks: this.plugins.postbacks.size,
      comments: this.plugins.comments.size,
      total: this.plugins.commands.size + 
             this.plugins.postbacks.size + 
             this.plugins.comments.size,
      duplicates: this.duplicates.size,
    };
  }

  // Log plugin statistics
  logPluginStats() {
    const stats = this.getStats();
    logger.info(
      `📊 Plugins: ${stats.commands} commands, ` +
      `${stats.postbacks} postbacks, ` +
      `${stats.comments} comments ` +
      `(Total: ${stats.total})`
    );
  }

  // Reload all plugins
  async reloadAll() {
    logger.info('🔄 Reloading all plugins...');
    
    // Clear existing plugins
    this.plugins = {
      commands: new Map(),
      postbacks: new Map(),
      comments: new Map(),
    };
    this.duplicates.clear();
    
    // Reload all plugins
    await this.loadAllPlugins();
    
    this.logPluginStats();
    return this.plugins;
  }

  // Cleanup
  cleanup() {
    for (const watcher of Object.values(this.watchers)) {
      watcher.close();
    }
  }
}

// Create singleton instance
const pluginLoader = new PluginLoader();

// Export functions
module.exports = {
  // Initialization
  initialize: () => pluginLoader.initialize(),
  
  // Loading
  loadPlugins: () => pluginLoader.initialize(),
  reloadPlugins: () => pluginLoader.reloadAll(),
  
  // Getters
  getCommandPlugins: () => pluginLoader.getCommandPlugins(),
  getPostbackPlugins: () => pluginLoader.getPostbackPlugins(),
  getCommentPlugins: () => pluginLoader.getCommentPlugins(),
  getPlugin: (type, name) => pluginLoader.getPlugin(type, name),
  getPluginStats: () => pluginLoader.getStats(),
  
  // Plugin execution helpers
  executeCommand: async (commandName, senderId, args = []) => {
    const plugin = pluginLoader.getPlugin('commands', commandName);
    if (plugin) {
      return plugin.start(senderId, args, `/${commandName} ${args.join(' ')}`);
    }
    throw new Error(`Command plugin not found: ${commandName}`);
  },
  
  executePostback: async (payload, senderId, recipientId) => {
    const plugins = pluginLoader.getPostbackPlugins();
    for (const plugin of plugins) {
      if (plugin.payload === payload || 
          (typeof payload === 'object' && payload.action === plugin.payload)) {
        return plugin.start(senderId, recipientId, payload);
      }
    }
    throw new Error(`Postback plugin not found for payload: ${payload}`);
  },
  
  // Cleanup
  cleanup: () => pluginLoader.cleanup(),
};