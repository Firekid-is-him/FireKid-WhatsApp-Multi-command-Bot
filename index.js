const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers, delay } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const { loadSessionFromGitHub } = require('./utils/sessionLoader');
const { loadCommands } = require('./utils/commandLoader');
const { setupAdminAPI } = require('./utils/adminAPI');

// Configuration
const config = {
  sessionId: process.env.SESSION_ID || '',
  prefix: process.env.PREFIX || '.',
  port: process.env.PORT || 3000,
  renderExternalUrl: process.env.RENDER_EXTERNAL_URL || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubRepo: 'https://github.com/idc-what-u-think/Firekid-MD-.git',
  adminApiKey: process.env.ADMIN_API_KEY || 'FIREKID_ADMIN_SECRET_KEY_2024',
};

// Bot state
let botState = {
  isActive: true,
  users: new Map(),
  stats: {
    totalCommands: 0,
    commandsToday: 0,
    startTime: new Date(),
  },
  sock: null,
};

// Commands storage
let commands = {};

// Main bot function
async function startBot() {
  try {
    console.log('🔥 Firekid WhatsApp Bot Starting...');
    console.log(`📋 Session ID: ${config.sessionId}`);
    console.log(`⚙️ Prefix: ${config.prefix}`);

    if (!config.sessionId) {
      console.error('❌ SESSION_ID not provided in environment variables!');
      process.exit(1);
    }

    if (!config.githubToken) {
      console.error('❌ GITHUB_TOKEN not provided in environment variables!');
      process.exit(1);
    }

    // Load session from GitHub
    console.log('📥 Loading session from GitHub...');
    const authDir = await loadSessionFromGitHub(config.sessionId, config.githubToken, config.githubRepo);
    
    if (!authDir) {
      console.error('❌ Failed to load session from GitHub!');
      process.exit(1);
    }

    // Load commands from GitHub
    console.log('📦 Loading commands from GitHub...');
    commands = await loadCommands(config.githubToken, config.githubRepo);
    console.log(`✅ Loaded ${Object.keys(commands).length} commands`);

    // Initialize WhatsApp connection
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      getMessage: async (key) => {
        return { conversation: '' };
      },
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

        console.log('❌ Connection closed. Reconnecting:', shouldReconnect);

        if (shouldReconnect) {
          setTimeout(() => startBot(), 5000);
        }
      } else if (connection === 'open') {
        console.log('✅ WhatsApp Bot Connected Successfully!');
        console.log(`🤖 Bot is running with prefix: ${config.prefix}`);
      }
    });

    // Message handler
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const messageText = msg.message.conversation || 
                           msg.message.extendedTextMessage?.text || '';

        // Check if bot is active
        if (!botState.isActive && sender !== 'admin') {
          continue; // Ignore all messages when bot is off
        }

        // Track user
        if (!botState.users.has(sender)) {
          botState.users.set(sender, {
            id: sender,
            firstSeen: new Date(),
            lastSeen: new Date(),
            messageCount: 0,
          });
        }
        const user = botState.users.get(sender);
        user.lastSeen = new Date();
        user.messageCount++;

        // Check if message starts with prefix
        if (!messageText.startsWith(config.prefix)) continue;

        const args = messageText.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // Find and execute command
        const command = commands[commandName];
        if (command && command.handler) {
          try {
            console.log(`🎯 Executing command: ${commandName} from ${sender}`);
            botState.stats.totalCommands++;
            botState.stats.commandsToday++;

            await command.handler(sock, msg, args, {
              from,
              sender,
              isGroup,
              prefix: config.prefix,
            });
          } catch (error) {
            console.error(`❌ Error executing command ${commandName}:`, error.message);
            await sock.sendMessage(from, {
              text: `⚠️ Error executing command: ${error.message}`,
            });
          }
        }
      }
    });

    botState.sock = sock;
    return sock;

  } catch (error) {
    console.error('❌ Bot startup error:', error.message);
    process.exit(1);
  }
}

// Auto-ping for Render
if (config.renderExternalUrl) {
  console.log('🔄 Setting up auto-ping for Render...');
  cron.schedule('*/10 * * * *', async () => {
    try {
      await axios.get(`${config.renderExternalUrl}/health`);
      console.log('✅ Auto-ping successful');
    } catch (error) {
      console.error('❌ Auto-ping failed:', error.message);
    }
  });
}

// Setup admin API
setupAdminAPI(config.port, config.adminApiKey, botState, (newState) => {
  botState.isActive = newState;
});

// Reset daily stats
cron.schedule('0 0 * * *', () => {
  botState.stats.commandsToday = 0;
  console.log('📊 Daily stats reset');
});

// Start the bot
startBot().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Bot shutting down gracefully...');
  if (botState.sock) {
    botState.sock.end();
  }
  process.exit(0);
});
