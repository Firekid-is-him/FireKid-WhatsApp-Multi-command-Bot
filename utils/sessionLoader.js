const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function loadSessionFromGitHub(sessionId, githubToken, repoUrl) {
  try {
    console.log(`🔍 Looking for session: ${sessionId}`);

    const tempDir = path.join(__dirname, '..', 'temp_repo');
    const authDir = path.join(__dirname, '..', 'auth_data');

    // Clean up existing directories
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }

    // Create auth directory
    fs.mkdirSync(authDir, { recursive: true });

    // Clone repo with token
    const cloneUrl = repoUrl.replace('https://', `https://${githubToken}@`);
    console.log('📥 Cloning repository...');
    
    execSync(`git clone "${cloneUrl}" "${tempDir}"`, {
      stdio: 'pipe',
      cwd: __dirname,
    });

    // Find session folder
    const sessionPath = path.join(tempDir, 'sessions', sessionId);
    
    if (!fs.existsSync(sessionPath)) {
      console.error(`❌ Session folder not found: sessions/${sessionId}`);
      console.error('Please make sure your SESSION_ID matches a folder in the GitHub repo.');
      return null;
    }

    console.log(`✅ Found session folder: ${sessionId}`);

    // Copy all session files to auth directory
    const files = fs.readdirSync(sessionPath);
    let copiedCount = 0;

    for (const file of files) {
      const srcPath = path.join(sessionPath, file);
      const destPath = path.join(authDir, file);

      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, destPath);
        copiedCount++;
        console.log(`📄 Copied: ${file}`);
      }
    }

    console.log(`✅ Copied ${copiedCount} session files`);

    // Clean up temp repo
    fs.rmSync(tempDir, { recursive: true, force: true });

    return authDir;

  } catch (error) {
    console.error('❌ Error loading session from GitHub:', error.message);
    return null;
  }
}

module.exports = { loadSessionFromGitHub };
