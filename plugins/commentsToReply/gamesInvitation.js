/**
 * Games Invitation Comment Plugin
 * Detects comments with keywords like "game", "play" or "fun" and
 * sends the commenter a private message inviting them to try the built‑in
 * games. The message includes quick reply buttons that trigger the
 * relevant postback payloads for Flip Coin and Rock–Paper–Scissors.
 * Author: OpenAI Assistant
 * Version: 1.0.0
 */

const fbApi = require('../../utils/fbApi');
const logger = require('../../utils/logger');

module.exports = {
  name: 'Games Invitation',
  // Keywords that will trigger this plugin when found in a comment
  keywords: ['game', 'play', 'fun'],

  /**
   * Run the games invitation logic. If the comment contains any of the
   * configured keywords, send a DM to the user with quick replies for
   * available games and postbacks.
   *
   * @param {Object} commentData - Data about the comment event.
   * @param {string} commentData.commentId - ID of the comment.
   * @param {string} commentData.postId - ID of the post.
   * @param {string} commentData.senderId - PSID of the user who commented.
   * @param {string} commentData.senderName - Name of the commenter.
   * @param {string} commentData.message - The comment text.
   * @returns {Promise<boolean>} Whether the plugin handled the comment.
   */
  run: async function(commentData) {
    try {
      const { commentId, senderId, senderName, message } = commentData;
      const lower = message.toLowerCase();
      const match = this.keywords.some(k => lower.includes(k.toLowerCase()));
      if (!match) {
        return false;
      }
      logger.info(`🎮 Games invitation triggered by ${senderName} (${senderId})`);
      // Public reply to acknowledge the comment
      await fbApi.replyToComment(
        commentId,
        `Hey ${senderName}! I’ve sent you a DM with some fun games to try. 🎲`
      );
      // Compose DM with quick replies for games
      const dm = `Hi ${senderName}! Ready for some fun? Choose a game below to play:`;
      const quickReplies = [
        {
          content_type: 'text',
          title: '🪙 Flip Coin',
          payload: 'GAME_FLIP_COIN',
        },
        {
          content_type: 'text',
          title: '✊✋✌️ RPS',
          payload: 'GAME_RPS',
        },
      ];
      await fbApi.sendMessage(senderId, dm, 'quick_replies', { quickReplies });
      logger.info(`✅ Games invitation DM sent to ${senderName} (${senderId})`);
      return true;
    } catch (error) {
      logger.error('Error in games invitation comment plugin:', error);
      return false;
    }
  },
};
