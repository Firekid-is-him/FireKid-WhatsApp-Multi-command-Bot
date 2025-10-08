const express = require('express');
const app = express();

app.use(express.json());

// Middleware to check admin API key
function authenticateAdmin(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== req.app.locals.adminApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
}

function setupAdminAPI(port, adminApiKey, botState, setBotState) {
  app.locals.adminApiKey = adminApiKey;
  app.locals.botState = botState;
  app.locals.setBotState = setBotState;

  // Health check endpoint (for auto-ping)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date(),
    });
  });

  // Get bot status
  app.get('/api/admin/status', authenticateAdmin, (req, res) => {
    const uptime = Math.floor((new Date() - app.locals.botState.stats.startTime) / 1000);
    
    res.json({
      isActive: app.locals.botState.isActive,
      uptime: uptime,
      totalUsers: app.locals.botState.users.size,
      totalCommands: app.locals.botState.stats.totalCommands,
      commandsToday: app.locals.botState.stats.commandsToday,
      startTime: app.locals.botState.stats.startTime,
    });
  });

  // Toggle bot on/off
  app.post('/api/admin/toggle', authenticateAdmin, (req, res) => {
    const { status } = req.body;
    
    if (typeof status !== 'boolean') {
      return res.status(400).json({ error: 'Invalid status. Must be boolean.' });
    }

    app.locals.setBotState(status);
    app.locals.botState.isActive = status;

    console.log(`🔄 Bot status changed to: ${status ? 'ON' : 'OFF'}`);

    res.json({
      success: true,
      newStatus: status,
      message: `Bot is now ${status ? 'active' : 'inactive'}`,
    });
  });

  // Get user analytics
  app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    const users = Array.from(app.locals.botState.users.values()).map(user => ({
      id: user.id,
      firstSeen: user.firstSeen,
      lastSeen: user.lastSeen,
      messageCount: user.messageCount,
    }));

    res.json({
      users,
      total: users.length,
    });
  });

  // Broadcast message to all users
  app.post('/api/admin/broadcast', authenticateAdmin, async (req, res) => {
    const { message, targetUserId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!app.locals.botState.sock) {
      return res.status(500).json({ error: 'Bot is not connected' });
    }

    try {
      let sentCount = 0;
      let failedCount = 0;

      if (targetUserId) {
        // Send to specific user
        try {
          await app.locals.botState.sock.sendMessage(targetUserId, {
            text: `📢 *Broadcast Message*\n\n${message}`,
          });
          sentCount = 1;
        } catch (error) {
          failedCount = 1;
        }
      } else {
        // Send to all users
        for (const [userId] of app.locals.botState.users) {
          try {
            await app.locals.botState.sock.sendMessage(userId, {
              text: `📢 *Broadcast Message*\n\n${message}`,
            });
            sentCount++;
          } catch (error) {
            console.error(`Failed to send to ${userId}:`, error.message);
            failedCount++;
          }
        }
      }

      res.json({
        success: true,
        sentCount,
        failedCount,
        message: `Broadcast sent to ${sentCount} users, ${failedCount} failed`,
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get activity logs
  app.get('/api/admin/activity', authenticateAdmin, (req, res) => {
    // This is a placeholder - you can enhance this with actual logging
    res.json({
      activities: [
        {
          type: 'info',
          message: 'Bot statistics available',
          timestamp: new Date(),
        },
      ],
    });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Admin API running on port ${port}`);
    console.log(`🔑 Admin API Key: ${adminApiKey}`);
  });
}

module.exports = { setupAdminAPI };
