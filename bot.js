require('dotenv').config();
const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
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
      displayName: '⚡ Hermes-3-Llama-3.1-70B',
      apiModelName: 'NousResearch/Hermes-3-Llama-3.1-70B',
      maxTokens: 6522,
      temperature: 0.7,
      topP: 0.9
    },
    'qwen': {
      displayName: '💻 Qwen2.5-Coder-32B-Instruct',
      apiModelName: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      maxTokens: 5400,
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
  },
  image: {
    'flux': { displayName: '🎨 FLUX.1-dev', apiModelName: 'FLUX.1-dev' },
    'sd2': { displayName: '🖼️ SD2', apiModelName: 'SD2' },
    'SDXL1.0-base': { displayName: '🖼️ SDXL1.0-base', apiModelName: 'SDXL1.0-base' },
    'SD1.5': { displayName: '🖼️ SD1.5', apiModelName: 'SD1.5' },
    'SSD': { displayName: '🖼️ SSD', apiModelName: 'SSD' },
    'SDXL-turbo': { displayName: '🖼️ SDXL-turbo', apiModelName: 'SDXL-turbo' },
  },
  audio: {
    'melo_tts': { displayName: '🔊 Melo TTS', apiModelName: 'melo_tts' }
  }
};

const showCategorySelection = (ctx) => {
  ctx.reply('*📂 Choose a category:*', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Text Models', callback_data: 'category_text' }],
        [{ text: '🖼️ Image Models', callback_data: 'category_image' }],
        [{ text: '🎧 Audio Models', callback_data: 'category_audio' }]
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
  const apiKey = ctx.session.apiKey;
  const modelInfo = getModelInfo(modelKey);

  if (!apiKey || !modelKey || !modelInfo) return;

  const category = getModelCategory(modelKey);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };

  let url, data;
  if (category === 'text') {
    ctx.sendChatAction('typing');
    url = "https://api.hyperbolic.xyz/v1/chat/completions";
    data = {
      messages: [{ role: "user", content: input }],
      model: modelInfo.apiModelName,
      max_tokens: modelInfo.maxTokens,
      temperature: modelInfo.temperature,
      top_p: modelInfo.topP
    };
  } else if (category === 'image') {
    ctx.sendChatAction('upload_photo');
    url = "https://api.hyperbolic.xyz/v1/image/generation";
    data = {
      model_name: modelInfo.apiModelName,
      prompt: input,
      steps: 30,
      cfg_scale: 5,
      enable_refiner: false,
      height: 1024,
      width: 1024,
      backend: "auto"
    };
  } else if (category === 'audio') {
    ctx.sendChatAction('upload_voice');
    url = "https://api.hyperbolic.xyz/v1/audio/generation";
    data = { model_name: modelInfo.apiModelName, text: input, speed: 1 };
  }

  try {
    const res = await axios.post(url, data, { headers });
    const result = res.data;

    if (category === 'text') {
      const answer = result.choices[0].message.content;
      await ctx.reply(`✅ Answered`, { parse_mode: 'Markdown', reply_markup: getSwitchModelKeyboard() });
    } else if (category === 'image') {
      const img = result.images?.[0]?.image;
      if (img) await ctx.replyWithPhoto({ source: Buffer.from(img, 'base64') });
    } else if (category === 'audio') {
      const audio = result.audio;
      if (audio) await ctx.replyWithAudio({ source: Buffer.from(audio, 'base64'), filename: 'voice.mp3' });
    }
  } catch (e) {
    console.error('API error:', e);
    ctx.reply('❌ Failed to process input');
  }
}

async function processBulkQuestions(ctx) {
  while (ctx.session.bulkQuestions.length > 0) {
    if (ctx.session.stopBulk) {
      await ctx.reply('🛑 Stopped by user.');
      break;
    }

    const currentQuestion = ctx.session.bulkQuestions.shift(); // Remove and get the first question
    await handleModelInput(ctx, currentQuestion);
    await delay(Math.floor(Math.random() * (120000 - 60000)) + 60000); // Random delay between 60-120 seconds
  }

  if (!ctx.session.stopBulk) {
    await ctx.reply('✅ *All questions processed!*', { parse_mode: 'Markdown' });
  }

  ctx.session.bulkQuestions = [];
}

bot.command('start', (ctx) => {
  if (!ctx.session.apiKey) {
    ctx.reply('Welcome! Send your Hyperbolic API key to begin.', { parse_mode: 'Markdown' });
  } else {
    showCategorySelection(ctx);
  }
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

// Add /clear to clear bulk data
bot.command('clear', (ctx) => {
  ctx.session.bulkQuestions = [];
  ctx.reply('🗑️ Bulk questions cleared.', { parse_mode: 'Markdown' });
});

bot.command('bulk', (ctx) => {
  ctx.session.bulkQuestions = [];
  ctx.session.collecting = true;
  ctx.session.stopBulk = false;
  ctx.reply('📝 Please *enter your bulk questions now*, separated by commas. Once finished, press ✅ Done below.', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Done', callback_data: 'bulk_done' }]]
    }
  });
});

bot.command('stop', (ctx) => {
  ctx.session.stopBulk = true;
  ctx.reply('🛑 Stop request acknowledged.');
});

bot.command('status', (ctx) => {
  const apiKeyStatus = ctx.session.apiKey ? '✅ Set' : '❌ Not set';
  const model = ctx.session.selectedModel ? getModelInfo(ctx.session.selectedModel)?.displayName : '❌ Not selected';
  const bulkCount = ctx.session.bulkQuestions?.length || 0;
  const isRunning = ctx.session.stopBulk === false ? '🟢 Running' : '⚪ Not running';

  ctx.reply(`📊 *Status Report:*\n\n🔑 API Key: ${apiKeyStatus}\n🧠 Model: ${model}\n📦 Bulk Questions: ${bulkCount}\n🚀 Bulk Processing: ${isRunning}`, {
    parse_mode: 'Markdown'
  });
});

bot.on('text', async (ctx) => {
  if (ctx.session.collecting) {
    const input = ctx.message.text;
    ctx.session.bulkQuestions = input.split(',').map(q => q.trim()).filter(Boolean);
    ctx.reply(`🗂️ ${ctx.session.bulkQuestions.length} questions collected. Click Done when ready.`);
  } else if (!ctx.session.apiKey) {
    ctx.session.apiKey = ctx.message.text;
    ctx.reply('✅ API key saved!');
    showCategorySelection(ctx);
  } else if (ctx.session.selectedModel) {
    await handleModelInput(ctx, ctx.message.text);
  } else {
    ctx.reply('⚠️ Select model first!');
  }
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCbQuery();

  if (data === 'bulk_done') {
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
