/**
 * DM Comment Plugin
 * Sends DM when keywords are detected in comments
 * Author: IRFAN
 * Version: 2.0.0
 */

const fbApi = require('../../utils/fbApi');
const logger = require('../../utils/logger');

module.exports = {
  name: 'DM Plugin',
  keywords: ['inbox', 'dm', 'message me', 'check inbox', 'pm'],
  
  run: async function(commentData) {
    try {
      const { commentId, postId, senderId, senderName, message } = commentData;
      const lowerMessage = message.toLowerCase();
      
      // Check if message contains any keyword
      const hasKeyword = this.keywords.some(keyword => 
        lowerMessage.includes(keyword.toLowerCase())
      );
      
      if (!hasKeyword) {
        return false; // Not handled by this plugin
      }
      
      logger.info(`💬 DM plugin triggered by ${senderName} (${senderId})`);
      
      // Send public reply
      await fbApi.replyToComment(commentId, 
        `Hi ${senderName}! I've sent you a private message. Please check your inbox.`
      );
      
      // Send private message with quick replies
      const dmMessage = `Hi ${senderName}! 👋\n\nThanks for your interest! How can I help you today?`;
      
      const quickReplies = [
        {
          content_type: 'text',
          title: '📞 Contact Info',
          payload: 'CONTACT_INFO',
        },
        {
          content_type: 'text',
          title: '💼 Services',
          payload: 'OUR_SERVICES',
        },
        {
          content_type: 'text',
          title: '🛒 Pricing',
          payload: 'PRICING_INFO',
        },
        {
          content_type: 'text',
          title: '❓ Help',
          payload: 'HELP_MENU',
        },
      ];
      
      await fbApi.sendMessage(senderId, dmMessage, 'quick_replies', {
        quickReplies,
      });
      
      // Send follow-up message
      await fbApi.sendMessage(senderId,
        'Feel free to ask any questions or use the quick replies above to get started!'
      );
      
      logger.info(`✅ DM sent to ${senderName} (${senderId})`);
      return true; // Successfully handled
      
    } catch (error) {
      logger.error('Error in DM comment plugin:', error);
      
      // Try to send error notification to admin
      try {
        await fbApi.sendMessage(commentData.senderId,
          'Sorry, I encountered an error sending you a message. Please try again later.'
        );
      } catch (e) {
        // Ignore secondary error
      }
      
      return false; // Not handled successfully
    }
  },
};
