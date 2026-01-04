/**
 * Flip Coin Game Postback Plugin
 * Provides a simple coin flip game when triggered via postback.
 * Author: OpenAI Assistant
 * Version: 1.0.0
 */

const fbApi = require('../../utils/fbApi');

module.exports = {
  // Unique payload identifier for this game. When the user triggers a postback
  // with this payload, the start function will run.
  payload: 'GAME_FLIP_COIN',

  /**
   * Start the coin flip game. This function chooses a random outcome
   * (Heads or Tails) and sends the result back to the user via Messenger.
   *
   * @param {string} senderId - The PSID of the user who triggered the postback.
   * @param {string} recipientId - The PSID of the page (unused but kept for API compatibility).
   * @param {*} payload - The postback payload, ignored here as this game does not require parameters.
   */
  start: async function(senderId, recipientId, payload) {
    try {
      // Randomly pick heads or tails
      const outcome = Math.random() < 0.5 ? 'Heads' : 'Tails';
      await fbApi.sendMessage(
        senderId,
        `🪙 You flipped a coin… it landed on *${outcome}*!`
      );
    } catch (error) {
      console.error('Error in flip coin postback:', error);
      await fbApi.sendMessage(senderId,
        'Sorry, there was an error flipping the coin. Please try again later.'
      );
    }
  },
};