/**
 * Unified Event Handler System
 * Routes messages, postbacks, and comments to appropriate plugins
 * Author: IRFAN
 * Version: 2.0.0
 */

const config = require('../config.json');
const fbApi = require('../utils/fbApi');
const logger = require('../utils/logger');
const { MessageTracker } = require('../utils/trackers');

const messageTracker = new MessageTracker();

// Command prefix matching
function getCommand(text) {
  if (!text || typeof text !== 'string') return null;
  
  const prefix = config.bot.prefix;
  if (!text.startsWith(prefix)) return null;
  
  const args = text.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  
  return { command, args, original: text };
}

// Handle incoming messages
async function handleMessage(message, senderId, recipientId, timestamp) {
  try {
    const text = message.text || '';
    const attachments = message.attachments || [];
    const quickReply = message.quick_reply;
    
    logger.info(`ðŸ“© Message from ${senderId}: ${text.substring(0, 100)}`);
    
    // Handle quick replies
    if (quickReply) {
      return handleQuickReply(quickReply, senderId);
    }
    
    // Handle attachments
    if (attachments.length > 0) {
      await handleAttachments(attachments, senderId);
    }
    
    // Handle commands
    const commandData = getCommand(text);
    if (commandData) {
      await handleCommand(commandData, senderId, recipientId);
    } else {
      // Handle non-command messages
      await handleRegularMessage(text, senderId);
    }
    
    // Track successful handling
    messageTracker.trackMessage(senderId, 'message', true);
  } catch (error) {
    logger.error('Error handling message:', error);
    messageTracker.trackMessage(senderId, 'message', false);
    
    // Send error message to user
    await fbApi.sendMessage(senderId, 
      'Sorry, I encountered an error processing your message. Please try again.'
    );
  }
}

// Handle postbacks
async function handlePostback(postback, senderId, recipientId, timestamp) {
  try {
    let payload;
    
    // Parse payload (could be JSON or string)
    try {
      payload = JSON.parse(postback.payload);
    } catch {
      payload = postback.payload;
    }
    
    logger.info(`ðŸ”˜ Postback from ${senderId}:`, payload);
    
    // Load postback plugins
    const postbackPlugins = require('../utils/pluginLoader').getPostbackPlugins();
    
    // Find matching plugin
    for (const plugin of postbackPlugins) {
      if (plugin.payload === payload || 
          (typeof payload === 'object' && payload.action === plugin.payload)) {
        
        // Execute plugin
        await plugin.start(senderId, recipientId, payload);
        
        // Track successful handling
        messageTracker.trackMessage(senderId, 'postback', true);
        return;
      }
    }
    
    logger.warn(`No plugin found for postback: ${payload}`);
    await fbApi.sendMessage(senderId, 
      'Sorry, that action is not available right now.'
    );
    
  } catch (error) {
    logger.error('Error handling postback:', error);
    messageTracker.trackMessage(senderId, 'postback', false);
  }
}

// Handle comments
async function handleComment(commentData, pageId) {
  try {
    const { commentId, postId, senderId, senderName, message, createdAt } = commentData;
    
    logger.info(`ðŸ’¬ Comment from ${senderName}: ${message}`);
    
    // Load comment plugins
    const commentPlugins = require('../utils/pluginLoader').getCommentPlugins();
    
    // Try each plugin until one handles the comment
    for (const plugin of commentPlugins) {
      const handled = await plugin.run(commentData);
      if (handled) {
        // Track successful handling
        messageTracker.trackMessage(senderId, 'comment', true);
        return;
      }
    }
    
    // No plugin handled the comment
    logger.debug(`No comment plugin matched for: ${message}`);
    
  } catch (error) {
    logger.error('Error handling comment:', error);
    messageTracker.trackMessage(commentData.senderId, 'comment', false);
  }
}

// Handle quick replies
async function handleQuickReply(quickReply, senderId) {
  const payload = quickReply.payload;
  
  // Quick replies are handled as postbacks
  await handlePostback({ payload }, senderId, 'page', Date.now());
}

// Handle attachments
async function handleAttachments(attachments, senderId) {
  for (const attachment of attachments) {
    const type = attachment.type;
    const url = attachment.payload?.url;
    
    logger.info(`ðŸ“Ž ${type} attachment from ${senderId}: ${url}`);
    
    switch (type) {
      case 'image':
        await fbApi.sendMessage(senderId, 'Thanks for the image!');
        break;
      case 'video':
        await fbApi.sendMessage(senderId, 'Thanks for the video!');
        break;
      case 'audio':
        await fbApi.sendMessage(senderId, 'Thanks for the audio message!');
        break;
      case 'file':
        await fbApi.sendMessage(senderId, 'Thanks for the file!');
        break;
      case 'location':
        const { lat, long } = attachment.payload.coordinates;
        await fbApi.sendMessage(senderId, 
          `Thanks for sharing your location: ${lat}, ${long}`
        );
        break;
    }
  }
}

// Handle commands
async function handleCommand(commandData, senderId, recipientId) {
  const { command, args } = commandData;
  
  // Load command plugins
  const commandPlugins = require('../utils/pluginLoader').getCommandPlugins();
  
  // Find matching command
  for (const plugin of commandPlugins) {
    if (plugin.config.name === command || 
        (plugin.config.aliases && plugin.config.aliases.includes(command))) {
      
      // Check if user is admin for admin commands
      if (plugin.config.category === 'admin' && 
          !config.security.adminUIDs.includes(senderId)) {
        await fbApi.sendMessage(senderId, 
          'You do not have permission to use this command.'
        );
        return;
      }
      
      // Execute command
      await plugin.start(senderId, args, commandData.original);
      return;
    }
  }
  
  // Command not found
  await handleUnknownCommand(command, senderId);
}

// Handle regular messages (non-commands)
async function handleRegularMessage(text, senderId) {
  // You can implement AI response, keyword matching, etc.
  const responses = [
    "Thanks for your message!",
    "How can I help you today?",
    "You can use commands like /help to see what I can do!",
    "I'm here to assist you with your questions.",
  ];
  
  const randomResponse = responses[Math.floor(Math.random() * responses.length)];
  await fbApi.sendMessage(senderId, randomResponse);
}

// Handle unknown commands
async function handleUnknownCommand(command, senderId) {
  const helpText = `Command "${command}" not found. Use /help to see available commands.`;
  await fbApi.sendMessage(senderId, helpText);
}

module.exports = {
  handleMessage,
  handlePostback,
  handleComment,
  handleQuickReply,
  handleAttachments,
  handleCommand,
  handleRegularMessage,
  handleUnknownCommand,
};
