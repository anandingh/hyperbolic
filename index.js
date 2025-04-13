const fs = require('fs');
const readline = require('readline');
const { exec } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// Read existing .env file (if any)
function getExistingBotCount() {
  if (!fs.existsSync('.env')) return 0;
  const content = fs.readFileSync('.env', 'utf-8');
  const matches = content.match(/TELEGRAM_BOT_TOKEN_\d+=/g);
  return matches ? matches.length : 0;
}

(async () => {
  const existingCount = getExistingBotCount();
  console.log(`🔍 Found ${existingCount} existing bot token(s) in .env`);

  const overwrite = existingCount > 0
    ? (await ask('📝 Overwrite existing .env file? (y/n): ')).toLowerCase() === 'y'
    : true;

  if (overwrite && existingCount > 0) {
    fs.writeFileSync('.env', '');
    console.log('🧹 Cleared existing .env content');
  }

  const botCount = parseInt(await ask('🤖 How many Telegram Bot API keys do you want to enter? '), 10);
  const usePm2 = (await ask('⚙️  Use PM2 to launch bots? (y/n): ')).toLowerCase() === 'y';

  const tokens = [];
  for (let i = 0; i < botCount; i++) {
    const token = await ask(`🔑 Enter token for bot #${existingCount + i + 1}: `);
    tokens.push(token);
  }

  // Append to .env
  const newEnvData = tokens.map((token, i) =>
    `TELEGRAM_BOT_TOKEN_${existingCount + i + 1}=${token}`
  ).join('\n') + '\n';

  fs.appendFileSync('.env', newEnvData);
  console.log('✅ Saved tokens to .env');

  // Launch bots
  tokens.forEach((_, i) => {
    const botId = existingCount + i + 1;
    const command = usePm2
      ? `pm2 start bot.js --name bot${botId} --env TELEGRAM_BOT_ID=${botId}`
      : `TELEGRAM_BOT_ID=${botId} node bot.js`;

    console.log(`🚀 Launching bot #${botId} (${usePm2 ? 'PM2' : 'Node'})`);
    exec(command, (err, stdout, stderr) => {
      if (err) {
        console.error(`❌ Bot #${botId} exited with error:\n`, stderr);
      } else {
        console.log(`📤 Bot #${botId} output:\n`, stdout);
      }
    });
  });

  rl.close();
})();
