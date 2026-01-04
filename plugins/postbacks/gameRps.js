/**
 * Rock–Paper–Scissors Game Postback Plugin
 * Allows the user to play a simple rock–paper–scissors game against the bot.
 * If the payload contains a `choice` property, it will be used as the user's
 * selection; otherwise the bot will prompt the user to send a valid choice.
 * Author: OpenAI Assistant
 * Version: 1.0.0
 */

const fbApi = require('../../utils/fbApi');

module.exports = {
  // Unique payload identifier for the RPS game. The plugin loader will match
  // this when the postback payload's action equals 'GAME_RPS'.
  payload: 'GAME_RPS',

  /**
   * Start the rock–paper–scissors game.
   * @param {string} senderId - The PSID of the user who triggered the postback.
   * @param {string} recipientId - The PSID of the page (unused here).
   * @param {*} payload - The postback payload. If it is an object with a
   *   `choice` property, that value is treated as the user's choice.
   */
  start: async function(senderId, recipientId, payload) {
    try {
      const choices = ['rock', 'paper', 'scissors'];
      // Extract the user's choice from the payload if provided
      let userChoice = '';
      if (typeof payload === 'object' && payload !== null) {
        userChoice = String(payload.choice || '').toLowerCase();
      }
      // If the user hasn't supplied a choice, instruct them how to play
      if (!choices.includes(userChoice)) {
        await fbApi.sendMessage(
          senderId,
          '🎮 Let’s play Rock–Paper–Scissors! Send a postback with your choice like `{ "action": "GAME_RPS", "choice": "rock" }`.'
        );
        return;
      }
      // Pick a random choice for the bot
      const botChoice = choices[Math.floor(Math.random() * choices.length)];
      // Determine the result
      let result;
      if (userChoice === botChoice) {
        result = "It's a draw!";
      } else if (
        (userChoice === 'rock' && botChoice === 'scissors') ||
        (userChoice === 'paper' && botChoice === 'rock') ||
        (userChoice === 'scissors' && botChoice === 'paper')
      ) {
        result = 'You win! 🎉';
      } else {
        result = 'I win! 😎';
      }
      await fbApi.sendMessage(
        senderId,
        `You chose *${userChoice}*, I chose *${botChoice}*. ${result}`
      );
    } catch (error) {
      console.error('Error in RPS postback:', error);
      await fbApi.sendMessage(
        senderId,
        'Sorry, there was an error playing Rock–Paper–Scissors. Please try again later.'
      );
    }
  },
};