require('dotenv').config();
const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const axios = require('axios');
const { loadProgress, saveProgress, clearProgress } = require('./bulkStorage');

const botId = process.env.TELEGRAM_BOT_ID;
const token = process.env[`TELEGRAM_BOT_TOKEN_${botId}`];
if (!token) {
  console.error(`❌ No token found for TELEGRAM_BOT_TOKEN_${botId}`);
  process.exit(1);
}

const bot = new Telegraf(token);
const session = new LocalSession({ getSessionKey: (ctx) => ctx.from?.id.toString() });
bot.use(session.middleware());

const models = {
  text: {
    'meta_llama': {
      displayName: '🦙 Meta Llama 3.1 8B',
      apiModelName: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      maxTokens: 11002,
      temperature: 0.7,
      topP: 0.9
    },
    'deepseek': {
      displayName: '🔍 DeepSeek V3',
      apiModelName: 'deepseek-ai/DeepSeek-V3',
      maxTokens: 13540,
      temperature: 0.1,
      topP: 0.9
    },
    'hermes': {
      displayName: '💻 Qwen2.5-72B-Instruct',
      apiModelName: 'Qwen/Qwen2.5-72B-Instruct',
      maxTokens: 11450,
      temperature: 0.7,
      topP: 0.9
    },
    'meta-llama3.1': {
      displayName: '💻 Meta-Llama-3.1-405B',
      apiModelName: 'meta-llama/Meta-Llama-3.1-405B',
      maxTokens: 11450,
      temperature: 0.7,
      topP: 0.9
    }
  }
};

const showCategorySelection = (ctx) => {
  ctx.reply('*📂 Choose a category:*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Text Models', callback_data: 'category_text' }]
      ]
    }
  });
};

const showModelSelection = (ctx, category) => {
  const modelList = models[category];
  const buttons = Object.entries(modelList).map(([key, model]) => [{
    text: model.displayName,
    callback_data: `model_${key}`
  }]);
  ctx.reply(`*🔧 Choose ${category} model:*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
};

const getModelInfo = (key) => {
  for (const category in models) {
    if (models[category][key]) return models[category][key];
  }
  return null;
};

const getModelCategory = (key) => {
  for (const category in models) {
    if (models[category][key]) return category;
  }
  return null;
};

const getSwitchModelKeyboard = () => ({
  inline_keyboard: [[{ text: '🔄 Switch Model', callback_data: 'switch_model' }]]
});

const delay = ms => new Promise(res => setTimeout(res, ms));

async function handleModelInput(ctx, input) {
  const modelKey = ctx.session.selectedModel;
  const apiKey = process.env[`API_KEY_${botId}`];
  ctx.session.apiKey = apiKey;
  const modelInfo = getModelInfo(modelKey);

  if (!apiKey || !modelKey || !modelInfo) return;

  const category = getModelCategory(modelKey);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };

  const url = "https://api.hyperbolic.xyz/v1/chat/completions";
  const data = {
    messages: [{ role: "user", content: input }],
    model: modelInfo.apiModelName,
    max_tokens: modelInfo.maxTokens,
    temperature: modelInfo.temperature,
    top_p: modelInfo.topP
  };

  try {
    ctx.sendChatAction('typing');
    const res = await axios.post(url, data, { headers });
    const result = res.data;
    const answer = result.choices[0].message.content;
    await ctx.reply(`✅ Answered`, { parse_mode: 'Markdown', reply_markup: getSwitchModelKeyboard() });
  } catch (e) {
    console.error('API error:', e);
    ctx.reply('❌ Failed to process input');
  }
}

async function processBulkQuestions(ctx) {
  const total = ctx.session.bulkTotal;

  while (ctx.session.bulkQuestions.length > 0) {
    if (ctx.session.stopBulk) {
      await ctx.reply('🛑 Stopped by user.');
      break;
    }

    const currentQuestion = ctx.session.bulkQuestions[0];
    await handleModelInput(ctx, currentQuestion);

    ctx.session.bulkQuestions.shift();
    saveProgress(ctx.from.id.toString(), ctx.session.bulkQuestions, ctx.session.bulkTotal);

    const remaining = ctx.session.bulkQuestions.length;
    const answered = Math.max(total - remaining, 0);

    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;
    const filled = Math.round((percent / 100) * 10);
    const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);

    await ctx.reply(`📊 *Progress Update:*
✅ Answered: ${answered} / ${total}
📊 Progress: ${bar} ${percent}%`, { parse_mode: 'Markdown' });
    await delay(Math.floor(Math.random() * (300000 - 120000)) + 120000);
  }

  if (!ctx.session.stopBulk) {
    await ctx.reply('✅ *All questions processed!*', { parse_mode: 'Markdown' });
  }

  ctx.session.bulkQuestions = [];
  clearProgress(ctx.from.id.toString());
}

bot.command('start', async (ctx) => {
  const userId = ctx.from.id.toString();
  const saved = loadProgress(userId);
  if (saved) {
    ctx.session.bulkQuestions = saved.bulkQuestions;
    ctx.session.bulkTotal = saved.bulkTotal;
    await ctx.reply(`📁 Resuming from where you left off...\n${saved.bulkQuestions.length} questions remaining.`);
  }
  showCategorySelection(ctx);
});

bot.command('bulk', (ctx) => {
  ctx.reply('📦 What would you like to do with bulk questions?', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🆕 NEW', callback_data: 'bulk_new' }],
        [{ text: '🔁 RESUME', callback_data: 'bulk_resume' }],
        [{ text: '❌ EXIT', callback_data: 'bulk_exit' }]
      ]
    }
  });
});

bot.command('help', (ctx) => {
  ctx.reply('📚 Commands:\n/start - Begin\n/switch - Change model\n/bulk - Send questions in bulk\n/stop - Stop bulk\n/remove - Clear key\n/clear - Clear bulk questions', { parse_mode: 'Markdown' });
});

bot.command('switch', (ctx) => {
  if (ctx.session.apiKey) showCategorySelection(ctx);
  else ctx.reply('🔑 Send your API key first.', { parse_mode: 'Markdown' });
});

bot.command('remove', (ctx) => {
  delete ctx.session.apiKey;
  delete ctx.session.selectedModel;
  ctx.reply('🗑️ API key and model cleared.', { parse_mode: 'Markdown' });
});

bot.command('clear', (ctx) => {
  ctx.session.bulkQuestions = [];
  ctx.session.bulkTotal = 0;
  clearProgress(ctx.from.id.toString());
  ctx.reply('🗑️ Bulk questions cleared.', { parse_mode: 'Markdown' });
});

bot.command('stop', (ctx) => {
  ctx.session.stopBulk = true;
  ctx.reply('🛑 Stop request acknowledged.');
});

bot.command('status', (ctx) => {
  const apiKey = process.env[`API_KEY_${botId}`];
  const maskedKey = apiKey ? `${apiKey.slice(0, 4)}**...**${apiKey.slice(-4)}` : '🔒 Not set';
  const modelKey = ctx.session.selectedModel;
  const modelInfo = modelKey ? getModelInfo(modelKey) : null;

  const total = ctx.session.bulkTotal || 0;
  const remaining = ctx.session.bulkQuestions?.length || 0;
  const answered = Math.max(total - remaining, 0);
  const percent = total > 0 ? Math.round((answered / total) * 100) : 0;
  const bar = '▓'.repeat(Math.round(percent / 10)) + '░'.repeat(10 - Math.round(percent / 10));

  ctx.reply(`📊 *Bot Status:*
🔐 API Key: ${maskedKey}
🧠 Model: ${modelInfo ? modelInfo.displayName : '❌ Not selected'}
✅ Answered: ${answered} / ${total}
📈 Progress: ${bar} ${percent}%`, { parse_mode: 'Markdown' });
});


bot.on('text', async (ctx) => {
  if (ctx.session.collecting) {
    const input = ctx.message.text;
    ctx.session.bulkQuestions = input.split(',').map(q => q.trim()).filter(Boolean);
    ctx.session.bulkTotal = ctx.session.bulkQuestions.length;
    ctx.reply(`🗂️ ${ctx.session.bulkQuestions.length} questions collected. Click Done.`);
  } else if (ctx.session.selectedModel) {
    await handleModelInput(ctx, ctx.message.text);
  } else {
    ctx.reply('⚠️ Select model first!');
  }
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();

  if (data === 'bulk_new') {
    ctx.session.bulkQuestions = [];
    ctx.session.bulkTotal = 0;
    clearProgress(ctx.from.id.toString());
    ctx.session.collecting = true;
    ctx.session.stopBulk = false;
    ctx.reply('📝 Enter your bulk questions separated by commas. Then click ✅ Done.', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '✅ Done', callback_data: 'bulk_done' }]]
      }
    });
  } else if (data === 'bulk_resume') {
    const saved = loadProgress(ctx.from.id.toString());
    if (saved && saved.bulkQuestions.length > 0) {
      ctx.session.bulkQuestions = saved.bulkQuestions;
      ctx.session.bulkTotal = saved.bulkTotal;
      ctx.session.stopBulk = false;

      if (!ctx.session.selectedModel) {
        ctx.reply('⚠️ Please select a model to continue.', getSwitchModelKeyboard());
      } else {
        ctx.reply(`📤 Resuming from question ${ctx.session.bulkTotal - ctx.session.bulkQuestions.length + 1}...`);
        processBulkQuestions(ctx);
      }
    } else {
      ctx.reply('❌ No saved progress found.');
    }
  } else if (data === 'bulk_exit') {
    ctx.reply('🚪 Exiting bulk setup.');
  } else if (data === 'bulk_done') {
    if (!ctx.session.bulkQuestions?.length) return ctx.reply('⚠️ Please enter questions first.');
    ctx.session.collecting = false;
    showCategorySelection(ctx);
  } else if (data === 'switch_model') {
    showCategorySelection(ctx);
  } else if (data.startsWith('category_')) {
    const category = data.split('_')[1];
    showModelSelection(ctx, category);
  } else if (data.startsWith('model_')) {
    const modelKey = data.replace('model_', '');
    ctx.session.selectedModel = modelKey;
    const modelInfo = getModelInfo(modelKey);
    await ctx.reply(`🎯 Selected: ${modelInfo.displayName}`);
    if (ctx.session.bulkQuestions?.length) {
      ctx.session.stopBulk = false;
      ctx.reply('📡 Starting bulk processing...');
      processBulkQuestions(ctx);
    }
  }
});

bot.launch();
console.log('🤖 Bot is running');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
