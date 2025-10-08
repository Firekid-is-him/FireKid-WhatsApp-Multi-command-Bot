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

const config = {
  sessionId: process.env.SESSION_ID || '',
  prefix: process.env.PREFIX || '.',
  port: process.env.PORT || 3000,
  renderExternalUrl: process.env.RENDER_EXTERNAL_URL || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  githubRepo: 'https://github.com/idc-what-u-think/Firekid-MD-.git',
  adminApiKey: process.env.ADMIN_API_KEY || 'FIREKID_ADMIN_SECRET_KEY_2024',
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
let reconnectTimeout = null;

function checkInstanceLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      const lockAge = Date.now() - lockData.timestamp;
      
      if (lockAge > 5 * 60 * 1000) {
        console.log('⚠️ Stale lock file found, removing...');
        fs.unlinkSync(LOCK_FILE);
        return true;
      }
      
      console.log('❌ Another instance is running (PID:', lockData.pid, ')');
