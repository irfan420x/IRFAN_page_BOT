/**
 * Enhanced Facebook Graph API Helper
 * Author: IRFAN
 * Version: 2.0.0
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const logger = require('./logger');

class FacebookAPI {
  constructor() {
    this.baseURL = 'https://graph.facebook.com/v18.0';
    this.accessToken = config.facebook.pageAccessToken;
    this.pageId = config.facebook.pageId;
    this.axios = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Generic request method with retry logic
  async request(method, endpoint, data = null, params = {}, retries = 3) {
    params = {
      ...params,
      access_token: this.accessToken,
    };

    try {
      const response = await this.axios({
        method,
        url: endpoint,
        data,
        params,
      });
      
      return response.data;
    } catch (error) {
      if (retries > 0 && error.response?.status >= 500) {
        logger.warn(`Retrying request to ${endpoint}, ${retries} retries left`);
        await this.delay(1000);
        return this.request(method, endpoint, data, params, retries - 1);
      }
      
      this.handleAPIError(error, endpoint);
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  handleAPIError(error, endpoint) {
    if (error.response) {
      const { status, data } = error.response;
      logger.error(`Facebook API Error [${status}] at ${endpoint}:`, data.error || data);
      
      // Handle specific error codes
      if (data.error) {
        switch (data.error.code) {
          case 190:
            logger.error('Invalid or expired access token');
            break;
          case 4:
            logger.error('Application request limit reached');
            break;
          case 10:
            logger.error('Permission denied');
            break;
          case 100:
            logger.error('Invalid parameter');
            break;
          case 368:
            logger.error('Temporary blocked for spamming');
            break;
        }
      }
    } else if (error.request) {
      logger.error(`No response from Facebook API at ${endpoint}:`, error.message);
    } else {
      logger.error(`Error setting up request to ${endpoint}:`, error.message);
    }
  }

  // Message sending methods
  async sendMessage(recipientId, message, type = 'text', options = {}) {
    try {
      let payload = {
        recipient: { id: recipientId },
      };

      switch (type) {
        case 'text':
          payload.message = { text: message };
          break;
          
        case 'quick_replies':
          payload.message = {
            text: message,
            quick_replies: options.quickReplies || [],
          };
          break;
          
        case 'buttons':
          payload.message = {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: message,
                buttons: options.buttons || [],
              },
            },
          };
          break;
          
        case 'generic':
          payload.message = {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'generic',
                elements: options.elements || [],
              },
            },
          };
          break;
          
        case 'media':
          if (options.url) {
            payload.message = {
              attachment: {
                type: options.mediaType || 'image',
                payload: {
                  url: options.url,
                  is_reusable: true,
                },
              },
            };
          }
          break;
          
        case 'audio':
          payload.message = {
            attachment: {
              type: 'audio',
              payload: {
                url: options.url,
                is_reusable: true,
              },
            },
          };
          break;
          
        case 'video':
          payload.message = {
            attachment: {
              type: 'video',
              payload: {
                url: options.url,
                is_reusable: true,
              },
            },
          };
          break;
          
        case 'file':
          payload.message = {
            attachment: {
              type: 'file',
              payload: {
                url: options.url,
                is_reusable: true,
              },
            },
          };
          break;
      }

      const response = await this.request('POST', '/me/messages', payload);
      logger.info(`✅ Message sent to ${recipientId}`);
      return response;
    } catch (error) {
      logger.error(`Failed to send message to ${recipientId}:`, error.message);
      throw error;
    }
  }

  // Send typing indicators
  async sendTypingOn(recipientId) {
    try {
      const payload = {
        recipient: { id: recipientId },
        sender_action: 'typing_on',
      };
      return await this.request('POST', '/me/messages', payload);
    } catch (error) {
      logger.error(`Failed to send typing indicator to ${recipientId}:`, error.message);
    }
  }

  async sendTypingOff(recipientId) {
    try {
      const payload = {
        recipient: { id: recipientId },
        sender_action: 'typing_off',
      };
      return await this.request('POST', '/me/messages', payload);
    } catch (error) {
      logger.error(`Failed to send typing off to ${recipientId}:`, error.message);
    }
  }

  async markSeen(recipientId) {
    try {
      const payload = {
        recipient: { id: recipientId },
        sender_action: 'mark_seen',
      };
      return await this.request('POST', '/me/messages', payload);
    } catch (error) {
      logger.error(`Failed to mark seen for ${recipientId}:`, error.message);
    }
  }

  // Comment management
  async replyToComment(commentId, message, options = {}) {
    try {
      const payload = {
        message,
        ...options,
      };
      
      const response = await this.request('POST', `/${commentId}/comments`, payload);
      logger.info(`✅ Replied to comment ${commentId}`);
      return response;
    } catch (error) {
      logger.error(`Failed to reply to comment ${commentId}:`, error.message);
      throw error;
    }
  }

  async deleteComment(commentId) {
    try {
      return await this.request('DELETE', `/${commentId}`);
    } catch (error) {
      logger.error(`Failed to delete comment ${commentId}:`, error.message);
      throw error;
    }
  }

  async hideComment(commentId) {
    try {
      const payload = { is_hidden: true };
      return await this.request('POST', `/${commentId}`, payload);
    } catch (error) {
      logger.error(`Failed to hide comment ${commentId}:`, error.message);
      throw error;
    }
  }

  // Page information
  async getPageInfo() {
    try {
      const fields = [
        'id',
        'name',
        'about',
        'fan_count',
        'followers_count',
        'link',
        'picture{url}',
        'cover{source}',
        'emails',
        'website',
        'verification_status',
        'is_verified',
        'location',
      ].join(',');
      
      const data = await this.request('GET', `/${this.pageId}`, null, { fields });
      
      return {
        id: data.id,
        name: data.name,
        about: data.about || '',
        likes: data.fan_count || 0,
        followers: data.followers_count || 0,
        link: data.link || '',
        picture: data.picture?.data?.url || '',
        cover: data.cover?.source || '',
        emails: data.emails || [],
        website: data.website || '',
        verificationStatus: data.verification_status || '',
        isVerified: data.is_verified || false,
        location: data.location || null,
      };
    } catch (error) {
      logger.error('Failed to fetch page info:', error.message);
      throw error;
    }
  }

  // Page insights
  async getInsights(metric = 'page_impressions', period = 'day', since = null, until = null) {
    try {
      const params = {
        metric,
        period,
      };
      
      if (since) params.since = since;
      if (until) params.until = until;
      
      const data = await this.request('GET', `/${this.pageId}/insights`, null, params);
      
      if (data.data && data.data.length > 0) {
        return data.data[0].values;
      }
      
      return [];
    } catch (error) {
      logger.error(`Failed to fetch insights for metric ${metric}:`, error.message);
      throw error;
    }
  }

  // Post creation
  async createPost(message, options = {}) {
    try {
      const payload = {
        message,
        ...options,
      };
      
      const response = await this.request('POST', `/${this.pageId}/feed`, payload);
      logger.info(`✅ Post created: ${response.id}`);
      return response;
    } catch (error) {
      logger.error('Failed to create post:', error.message);
      throw error;
    }
  }

  // User profile
  async getUserProfile(userId) {
    try {
      const fields = [
        'id',
        'name',
        'first_name',
        'last_name',
        'profile_pic',
        'locale',
        'timezone',
        'gender',
      ].join(',');
      
      return await this.request('GET', `/${userId}`, null, { fields });
    } catch (error) {
      logger.error(`Failed to fetch user profile for ${userId}:`, error.message);
      throw error;
    }
  }

  // Upload media
  async uploadMedia(filePath, mediaType = 'image') {
    try {
      const formData = new FormData();
      formData.append('source', fs.createReadStream(filePath));
      formData.append('access_token', this.accessToken);
      
      const endpoint = mediaType === 'video' 
        ? `/${this.pageId}/videos`
        : `/${this.pageId}/photos`;
      
      const response = await axios.post(
        `${this.baseURL}${endpoint}`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 60000,
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error(`Failed to upload media ${filePath}:`, error.message);
      throw error;
    }
  }

  // Get conversation
  async getConversation(userId, limit = 50) {
    try {
      const params = {
        fields: 'messages.limit(' + limit + '){message,from,created_time,attachments}',
      };
      
      const data = await this.request('GET', `/${this.pageId}/conversations`, null, params);
      
      if (data.data && data.data.length > 0) {
        return data.data;
      }
      
      return [];
    } catch (error) {
      logger.error(`Failed to fetch conversation with ${userId}:`, error.message);
      throw error;
    }
  }

  // Batch requests
  async batchRequests(requests) {
    try {
      const batch = requests.map((req, index) => ({
        method: req.method || 'GET',
        relative_url: req.url,
        body: req.body ? `access_token=${this.accessToken}&${req.body}` : null,
        name: req.name || `request_${index}`,
      }));
      
      const payload = { batch: JSON.stringify(batch) };
      return await this.request('POST', '/', payload);
    } catch (error) {
      logger.error('Failed to execute batch requests:', error.message);
      throw error;
    }
  }
}

module.exports = new FacebookAPI();