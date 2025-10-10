const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const P = require('pino');
const crypto = require('crypto');
require('dotenv').config();

const { loadSessionFromGitHub } = require('./utils/sessionLoader');
const { loadCommands } = require('./utils/commandLoader');
const { setupAdminAPI } = require('./utils/adminAPI');

const logger = P({ level: 'silent' });

const DASHBOARD_URL = 'https://firekidxmd.vercel.app';
const BOT_WEBHOOK_URL = `${DASHBOARD_URL}/api/bot-webhook`;
const _k = Buffer.from('ODU0MTZhOTItNmRiOS00MTdhLWJhOWQtY2I1NjQ0MmY5NzY0', 'base64').toString('utf8');
const CONFIG_FILE = path.join(__dirname, '.bot-config.json');

const config = {
  sessionId: process.env.SESSION_ID || '',
  prefix: process.env.PREFIX || '.',
  port: process.env.PORT || 3000,
  renderExternalUrl: process.env.RENDER_EXTERNAL_URL || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubRepo: 'https://github.com/idc-what-u-think/Firekid-MD-.git',
  ownerNumber: process.env.OWNER_NUMBER || '',
};

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

let commands = {};
const LOCK_FILE = path.join(__dirname, '.bot.lock');
let isConnecting = false;

function getOrCreateBotConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const botConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return botConfig;
    }
  } catch (error) {
    console.log('Creating new bot configuration...');
  }

  const botConfig = {
    botId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2));
  
  return botConfig;
}

async function registerWithDashboard(botConfig) {
  try {
    const apiUrl = config.renderExternalUrl || `http://localhost:${config.port}`;
    
    const response = await axios.post(
      `${DASHBOARD_URL}/api/admin/register-bot`,
      {
        botId: botConfig.botId,
        name: process.env.BOT_NAME || 'Firekid WhatsApp Bot',
        apiUrl: apiUrl,
        apiKey: _k,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${_k}`
        },
        timeout: 10000
      }
    );

    return response.data;
  } catch (error) {
  }
}

async function sendHeartbeat(botConfig) {
  try {
    const apiUrl = config.renderExternalUrl || `http://localhost:${config.port}`;
    
    await axios.post(
      `${DASHBOARD_URL}/api/admin/register-bot`,
      {
        botId: botConfig.botId,
        name: process.env.BOT_NAME || 'Firekid WhatsApp Bot',
        apiUrl: apiUrl,
        apiKey: _k,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${_k}`
        }
      }
    );
  } catch (error) {
  }
}

function checkInstanceLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const lockAge = Date.now() - lockData.timestamp;
      
      if (lockAge > 5 * 60 * 1000) {
        fs.unlinkSync(LOCK_FILE);
        return true;
      }
      
      console.log('❌ Another instance detected');
      return false;
    } catch (error) {
      fs.unlinkSync(LOCK_FILE);
      return true;
    }
  }
  return true;
}

function createInstanceLock() {
  const lockData = {
    pid: process.pid,
    timestamp: Date.now(),
    startedAt: new Date().toISOString()
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
}

function removeInstanceLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

async function startBot() {
  try {
    if (isConnecting) {
      return;
    }

    if (!checkInstanceLock()) {
      process.exit(1);
    }

    isConnecting = true;
    createInstanceLock();

    const botConfig = getOrCreateBotConfig();

    if (!config.sessionId) {
      console.error('❌ SESSION_ID not provided in environment variables!');
      process.exit(1);
    }

    if (!config.githubToken) {
      console.error('❌ GITHUB_TOKEN not provided in environment variables!');
      process.exit(1);
    }

    if (!config.ownerNumber) {
      console.warn('⚠️ OWNER_NUMBER not configured. Owner-only commands will be disabled.');
    }

    console.log('🔄 Connecting...');
    const authDir = await loadSessionFromGitHub(config.sessionId, config.githubToken, config.githubRepo);
    
    if (!authDir) {
      console.error('❌ Failed to load session from GitHub!');
      process.exit(1);
    }

    console.log('📦 Installing plugins...');
    commands = await loadCommands(config.githubToken, config.githubRepo);
    console.log(`✅ Plugins installed`);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      logger: logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000,
      getMessage: async (key) => {
        return { conversation: '' };
      },
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        isConnecting = false;
        
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

        console.log('❌ Connection closed. Reason:', statusCode);

        if (statusCode === 403) {
          console.log('🚫 Account banned by WhatsApp (403 Forbidden)');
          console.log('❌ Cannot reconnect - number is restricted');
          removeInstanceLock();
          process.exit(1);
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          console.log('⚠️ Connection replaced - Another device connected');
          console.log('🛑 Exiting to prevent conflict');
          removeInstanceLock();
          process.exit(1);
          return;
        }

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('🔐 Logged out - Session expired or deleted');
          removeInstanceLock();
          process.exit(0);
          return;
        }

        if (statusCode === DisconnectReason.badSession) {
          console.log('❌ Bad session - Session file corrupted');
          removeInstanceLock();
          process.exit(1);
          return;
        }

        if (statusCode === DisconnectReason.multideviceMismatch) {
          console.log('❌ Multi-device mismatch - Re-scan QR code');
          removeInstanceLock();
          process.exit(1);
          return;
        }

        console.log('❌ Connection failed. Exiting...');
        removeInstanceLock();
        process.exit(1);
      } else if (connection === 'open') {
        isConnecting = false;
        console.log('✅ Connected');
        
        await registerWithDashboard(botConfig);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        let sender;
        
        if (isGroup) {
          sender = msg.key.participant || msg.key.remoteJid;
        } else {
          sender = msg.key.fromMe ? sock.user.id : msg.key.remoteJid;
        }
        
        if (sender && sender.includes(':')) {
          sender = sender.split(':')[0] + '@s.whatsapp.net';
        }
        
        if (commands.online && typeof commands.online.isAutoReadEnabled === 'function') {
          const autoReadEnabled = commands.online.isAutoReadEnabled();
          
          if (autoReadEnabled && !msg.key.fromMe) {
            try {
              await sock.readMessages([msg.key]);
            } catch (error) {
              console.error('Auto-read error:', error.message);
            }
          }
        }

        const messageText = msg.message.conversation || 
                           msg.message.extendedTextMessage?.text || '';

        if (!botState.isActive && sender !== 'admin') {
          continue;
        }

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

        if (!messageText.startsWith(config.prefix)) continue;

        const args = messageText.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (commands.private && typeof commands.private.isPrivateModeEnabled === 'function') {
          const isPrivateMode = commands.private.isPrivateModeEnabled();
          if (isPrivateMode) {
            const senderNumber = sender.replace(/[^0-9]/g, '');
            const ownerNum = config.ownerNumber.replace(/[^0-9]/g, '');
            
            if (senderNumber !== ownerNum) {
              continue;
            }
          }
        }

        const command = commands[commandName];
        if (command && command.handler) {
          try {
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
            }, { quoted: msg });
          }
        }
      }
    });

    botState.sock = sock;
    
    const heartbeatBotConfig = botConfig;
    setInterval(() => sendHeartbeat(heartbeatBotConfig), 5 * 60 * 1000);
    
    return sock;

  } catch (error) {
    isConnecting = false;
    console.error('❌ Bot startup error:', error.message);
    removeInstanceLock();
    process.exit(1);
  }
}

if (config.renderExternalUrl) {
  cron.schedule('*/10 * * * *', async () => {
    try {
      await axios.get(`${config.renderExternalUrl}/health`);
    } catch (error) {
    }
  });
}

setupAdminAPI(config.port, _k, botState, (newState) => {
  botState.isActive = newState;
});

cron.schedule('0 0 * * *', () => {
  botState.stats.commandsToday = 0;
});

process.on('SIGINT', () => {
  if (botState.sock) {
    botState.sock.end();
  }
  removeInstanceLock();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (botState.sock) {
    botState.sock.end();
  }
  removeInstanceLock();
  process.exit(0);
});

process.on('exit', () => {
  removeInstanceLock();
});

startBot().catch(console.error);
