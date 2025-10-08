const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function loadCommands(githubToken, repoUrl) {
  try {
    console.log('📦 Loading commands from GitHub...');

    const tempDir = path.join(__dirname, '..', 'temp_commands');

    // Clean up existing directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Clone repo with token
    const cloneUrl = repoUrl.replace('https://', `https://${githubToken}@`);
    
    execSync(`git clone "${cloneUrl}" "${tempDir}"`, {
      stdio: 'pipe',
      cwd: __dirname,
    });

    // Load commands from commands folder
    const commandsPath = path.join(tempDir, 'commands');
    
    if (!fs.existsSync(commandsPath)) {
      console.error('❌ Commands folder not found in repo');
      return {};
    }

    // Check if index.js exists
    const indexPath = path.join(commandsPath, 'index.js');
    
    if (fs.existsSync(indexPath)) {
      // Use the index.js to load commands
      const commands = require(indexPath);
      console.log(`✅ Loaded commands via index.js`);
      
      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return commands;
    } else {
      // Fallback: load individual command files
      const commands = {};
      const files = fs.readdirSync(commandsPath);

      for (const file of files) {
        if (file.endsWith('.js') && file !== 'index.js') {
          try {
            const commandPath = path.join(commandsPath, file);
            const command = require(commandPath);
            const commandName = file.replace('.js', '');
            
            if (command.command && command.handler) {
              commands[command.command] = command;
              console.log(`✅ Loaded: ${command.command}`);
            } else if (typeof command === 'function') {
              commands[commandName] = { command: commandName, handler: command };
              console.log(`✅ Loaded: ${commandName}`);
            }
          } catch (error) {
            console.error(`❌ Error loading ${file}:`, error.message);
          }
        }
      }

      // Clean up
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return commands;
    }

  } catch (error) {
    console.error('❌ Error loading commands from GitHub:', error.message);
    return {};
  }
}

module.exports = { loadCommands };
