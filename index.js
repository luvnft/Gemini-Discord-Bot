require('dotenv').config();
const fetch = require('node-fetch');
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
  ActivityType,
  StringSelectMenuBuilder,
  REST,
  Routes,
} = require('discord.js');
const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory
} = require('@google/generative-ai');
const { writeFile, unlink } = require('fs/promises');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pdf = require('pdf-parse');
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');

const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const token = process.env.DISCORD_BOT_TOKEN;
const activeRequests = new Set();

// Define your objects
let chatHistories = {};
let activeUsersInChannels = {};
let customInstructions = {};
let serverSettings = {};
let userPreferredImageModel = {};
let userPreferredImageResolution = {};
let userPreferredImagePromptEnhancement = {};
let userPreferredSpeechModel = {};
let userPreferredUrlHandle = {};
let userResponsePreference = {};
let alwaysRespondChannels = {};
let blacklistedUsers = {};

const CONFIG_DIR = path.join(__dirname, 'config');
const CHAT_HISTORIES_DIR = path.join(CONFIG_DIR, 'chat_histories');

const FILE_PATHS = {
  activeUsersInChannels: path.join(CONFIG_DIR, 'active_users_in_channels.json'),
  customInstructions: path.join(CONFIG_DIR, 'custom_instructions.json'),
  serverSettings: path.join(CONFIG_DIR, 'server_settings.json'),
  userPreferredImageModel: path.join(CONFIG_DIR, 'user_preferred_image_model.json'),
  userPreferredImageResolution: path.join(CONFIG_DIR, 'user_preferred_image_resolution.json'),
  userPreferredImagePromptEnhancement: path.join(CONFIG_DIR, 'user_preferred_image_prompt_enhancement.json'),
  userPreferredSpeechModel: path.join(CONFIG_DIR, 'user_preferred_speech_model.json'),
  userPreferredUrlHandle: path.join(CONFIG_DIR, 'user_preferred_url_handle.json'),
  userResponsePreference: path.join(CONFIG_DIR, 'user_response_preference.json'),
  alwaysRespondChannels: path.join(CONFIG_DIR, 'always_respond_channels.json'),
  blacklistedUsers: path.join(CONFIG_DIR, 'blacklisted_users.json')
};

function saveStateToFile() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    if (!fs.existsSync(CHAT_HISTORIES_DIR)) {
      fs.mkdirSync(CHAT_HISTORIES_DIR, { recursive: true });
    }

    for (let [key, value] of Object.entries(chatHistories)) {
      fs.writeFileSync(path.join(CHAT_HISTORIES_DIR, `${key}.json`), JSON.stringify(value, null, 2), 'utf-8');
    }

    for (let [key, value] of Object.entries(FILE_PATHS)) {
      fs.writeFileSync(value, JSON.stringify(eval(key), null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Error saving state to files:', error);
  }
}

function loadStateFromFile() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      console.warn('Config directory does not exist. Initializing with empty state.');
      return;
    }

    if (!fs.existsSync(CHAT_HISTORIES_DIR)) {
      fs.mkdirSync(CHAT_HISTORIES_DIR, { recursive: true });
    } else {
      fs.readdirSync(CHAT_HISTORIES_DIR).forEach(file => {
        if (file.endsWith('.json')) {
          const user = path.basename(file, '.json');
          try {
            const data = fs.readFileSync(path.join(CHAT_HISTORIES_DIR, file), 'utf-8');
            chatHistories[user] = JSON.parse(data);
          } catch (readError) {
            console.error(`Error reading chat history for ${user}:`, readError);
          }
        }
      });
    }

    for (let [key, value] of Object.entries(FILE_PATHS)) {
      if (fs.existsSync(value)) {
        try {
          const data = fs.readFileSync(value, 'utf-8');
          eval(`${key} = JSON.parse(data)`);
        } catch (readError) {
          console.error(`Error reading ${key}:`, readError);
        }
      }
    }
  } catch (error) {
    console.error('Error loading state from files:', error);
  }
}

loadStateFromFile();

// <=====[Configuration]=====>

const defaultResponseFormat = config.defaultResponseFormat;
const defaultImgModel = config.defaultImgModel;
const defaultUrlReading = config.defaultUrlReading;
const activities = config.activities.map(activity => ({
  name: activity.name,
  type: ActivityType[activity.type]
}));
const defaultPersonality = config.defaultPersonality;
const defaultServerSettings = config.defaultServerSettings;

const {
  speechGen,
  musicGen,
  videoGen,
  generateWithSC,
  generateWithPlayground,
  generateWithDallEXL,
  generateWithAnime,
  generateWithSDXL,
  generateWithPixArt_Sigma,
  generateWithDalle3,
  generateWithMobius
} = require('./generators');

// <==========>



// <=====[Register Commands And Activities]=====>

let activityIndex = 0;
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Load commands from commands.json
  const commandsPath = path.join(__dirname, 'commands.json');
  let commands = [];
  if (fs.existsSync(commandsPath)) {
    const commandsData = fs.readFileSync(commandsPath, 'utf-8');
    commands = JSON.parse(commandsData).commands;
  } else {
    console.error('commands.json file not found.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }

  client.user.setPresence({
    activities: [activities[activityIndex]],
    status: 'idle',
  });

  setInterval(() => {
    activityIndex = (activityIndex + 1) % activities.length;
    client.user.setPresence({
      activities: [activities[activityIndex]],
      status: 'idle',
    });
  }, 30000);
});

// <==========>



// <=====[Messages And Interaction]=====>

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    const isDM = message.channel.type === ChannelType.DM;
    const mentionPattern = new RegExp(`^<@!?${client.user.id}>(?:\\s+)?(generate|imagine)`, 'i');
    const startsWithPattern = /^generate|^imagine/i;
    const command = message.content.match(mentionPattern) || message.content.match(startsWithPattern);

    // Decide if the bot should respond based on channel conditions
    const shouldRespond = (
      alwaysRespondChannels[message.channelId] ||
      message.mentions.users.has(client.user.id) && !isDM ||
      activeUsersInChannels[message.channelId]?.[message.author.id] || isDM
    );

    if (shouldRespond) {
      if (message.guild) {
        initializeBlacklistForGuild(message.guild.id);
        if (blacklistedUsers[message.guild.id].includes(message.author.id)) {
          return message.reply({ content: 'You are blacklisted and cannot use this bot.' });
        }
      }
      if (command) {
        // Extract the command name and the prompt
        const prompt = message.content.slice(command.index + command[0].length).trim();
        if (prompt) {
          await genimg(prompt, message);
        } else {
          await message.channel.send("> `Please provide a valid prompt.`");
        }
      } else if (activeRequests.has(message.author.id)) {
        await message.reply('> `Please wait until your previous action is complete.`');
      } else if (message.attachments.size > 0 && hasImageAttachments(message)) {
        await handleImageMessage(message);
      } else if (message.attachments.size > 0 && hasTextFileAttachments(message)) {
        await handleTextFileMessage(message);
      } else {
        await handleTextMessage(message);
      }
    }
  } catch (error) {
    console.error('Error processing the message:', error.message);
    if (activeRequests.has(message.author.id)) {
      activeRequests.delete(message.author.id);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isCommand()) return;
    switch (interaction.commandName) {
      case 'respondtoall':
        await handleRespondToAllCommand(interaction);
        break;
      case 'whitelist':
        await handleWhitelistCommand(interaction);
        break;
      case 'blacklist':
        await handleBlacklistCommand(interaction);
        break;
      case 'imagine':
        await handleImagineCommand(interaction);
        break;
      case 'clear':
        const serverChatHistoryEnabled = interaction.guild ? serverSettings[interaction.guild.id]?.serverChatHistory : false;
        if (!serverChatHistoryEnabled) {
          await clearChatHistory(interaction);
        } else {
          await interaction.reply("Clearing chat history is not enabled for this server, Server-Wide chat history is active.");
        }
        break;
      case 'speech':
        await handleSpeechCommand(interaction);
        break;
      case 'settings':
        await showSettings(interaction);
        break;
      case 'dashboard':
        await showDashboard(interaction);
        break;
      case 'video':
        await handleVideoCommand(interaction);
        break;
      case 'music':
        await handleMusicCommand(interaction);
        break;
      default:
        console.log(`Unknown command: ${interaction.commandName}`);
        break;
    }
  } catch (error) {
    console.error('Error handling command:', error.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.guild) {
        initializeBlacklistForGuild(interaction.guild.id);
        if (blacklistedUsers[interaction.guild.id].includes(interaction.user.id)) {
          return interaction.reply({ content: 'You are blacklisted and cannot use this interaction.', ephemeral: true });
        }
      }
      switch (interaction.customId) {
        case 'server-chat-history':
          await toggleServerWideChatHistory(interaction);
          break;
        case 'clear-server':
          await clearServerChatHistory(interaction);
          break;
        case 'settings-save-buttons':
          await toggleSettingSaveButton(interaction);
          break;
        case 'custom-server-personality':
          await serverPersonality(interaction);
          break;
        case 'toggle-server-personality':
          await toggleServerPersonality(interaction);
          break;
        case 'download-server-conversation':
          await downloadServerConversation(interaction);
          break;
        case 'response-server-mode':
          await toggleServerPreference(interaction);
          break;
        case 'toggle-response-server-mode':
          await toggleServerResponsePreference(interaction);
          break;
        case 'settings':
          await showSettings(interaction);
          break;
        case 'clear':
          const serverChatHistoryEnabled = interaction.guild ? serverSettings[interaction.guild.id]?.serverChatHistory : false;
          if (!serverChatHistoryEnabled) {
            await clearChatHistory(interaction);
          } else {
            await interaction.reply({content: "Clearing chat history is not enabled for this server, Server-Wide chat history is active.", ephemeral: true});
          }
          break;
        case 'always-respond':
          await alwaysRespond(interaction);
          break;
        case 'custom-personality':
          const serverCustomEnabled = interaction.guild ? serverSettings[interaction.guild.id]?.customServerPersonality : false;
          if (!serverCustomEnabled) {
            await setCustomPersonality(interaction);
          } else {
            await interaction.reply({content: "Custom personality is not enabled for this server, Server-Wide personality is active.", ephemeral: true});
          }
          break;
        case 'remove-personality':
          const isServerEnabled = interaction.guild ? serverSettings[interaction.guild.id]?.customServerPersonality : false;
          if (!isServerEnabled) {
            await removeCustomPersonality(interaction);
          } else {
            await interaction.reply({content: "Custom personality is not enabled for this server, Server-Wide personality is active.", ephemeral: true});
          }
          break;
        case 'generate-image':
          await handleGenerateImageButton(interaction);
          break;
        case 'change-image-model':
          await changeImageModel(interaction);
          break;
        case 'toggle-prompt-enhancer':
          await togglePromptEnhancer(interaction);
          break;
        case 'change-image-resolution':
          await changeImageResolution(interaction);
          break;
        case 'toggle-response-mode':
          const serverResponsePreferenceEnabled = interaction.guild ? serverSettings[interaction.guild.id]?.serverResponsePreference : false;
          if (!serverResponsePreferenceEnabled) {
            await toggleUserPreference(interaction);
          } else {
            await interaction.reply({content: "Toggling Response Mode is not enabled for this server, Server-Wide Response Mode is active.", ephemeral: true});
          }
          break;
       case 'toggle-url-mode':
          await toggleUrlUserPreference(interaction);
          break;
        case 'generate-speech':
          await processSpeechGet(interaction);
          break;
        case 'generate-music':
          await processMusicGet(interaction);
          break;
        case 'generate-video':
          await processVideoGet(interaction);
          break;
        case 'change-speech-model':
          await changeSpeechModel(interaction);
          break;
        case 'download-conversation':
          await downloadConversation(interaction);
          break;
        case 'download_message':
          await downloadMessage(interaction);
          break;
        case 'exit':
          await interaction.message.delete();
          break;
        default:
          if (interaction.customId.startsWith('select-speech-model-')) {
            const selectedModel = interaction.customId.replace('select-speech-model-', '');
            await handleSpeechSelectModel(interaction, selectedModel);
          }
      }
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error('Error handling command:', error.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId === 'select-image-model') {
      const selectedModel = interaction.values[0];
      await handleImageSelectModel(interaction, selectedModel);
    } else if (interaction.customId === 'select-image-resolution') {
      const selectedResolution = interaction.values[0];
      await handleImageSelectResolution(interaction, selectedResolution);
    }
  } catch (error) {
    console.error('Error handling select menu interaction:', error.message);
  }
});

// <==========>



// <=====[Messages Handling]=====>

async function compressLargeImage(buffer) {
  try {
    const compressedBuffer = await sharp(buffer)
      .resize(3072, 3072, {
        fit: sharp.fit.inside,
        withoutEnlargement: true
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    if (compressedBuffer.length > 3.9 * 1024 * 1024) {
      throw new Error('Image too large after compression.');
    }

    return compressedBuffer;
  } catch (error) {
    console.error('Compression error:', error);
    throw new Error('The image is too large for Gemini to process even after attempting to compress it.');
  }
}

function hasImageAttachments(message) {
  return message.attachments.some((attachment) =>
    attachment.contentType?.startsWith('image/')
  );
}

async function handleImageMessage(message) {
  const imageAttachments = message.attachments.filter((attachment) =>
    attachment.contentType?.startsWith('image/')
  );

  let messageContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();

  if (imageAttachments.size > 0) {
    const imageParts = await Promise.all(
      imageAttachments.map(async attachment => {
        const response = await fetch(attachment.url);
        const buffer = await response.buffer();

        if (buffer.length > 3 * 1024 * 1024) {
          try {
            const compressedBuffer = await compressLargeImage(buffer);
            return { inlineData: { data: compressedBuffer.toString('base64'), mimeType: 'image/jpeg' } };
          } catch (error) {
            await message.reply(error.message);
            throw error;
          }
        } else {
          return { inlineData: { data: buffer.toString('base64'), mimeType: attachment.contentType } };
        }
      })
    );

    const isServerChatHistoryEnabled = message.guild ? serverSettings[message.guild.id]?.serverChatHistory : false;
    const instructions = message.guild ?
      (serverSettings[message.guild.id]?.customServerPersonality && customInstructions[message.guild.id] ?
        customInstructions[message.guild.id] :
        customInstructions[message.author.id]) :
      customInstructions[message.author.id];
    const visionModel = await genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction: { role: "system", parts: [{ text: instructions ? instructions : defaultPersonality }] } }, { apiVersion: 'v1beta' });
    const chat = visionModel.startChat({
      history: isServerChatHistoryEnabled ? getHistory(message.guild.id) : getHistory(message.author.id),
      safetySettings,
    });

    const botMessage = await message.reply({ content: 'Analyzing the image(s) with your text prompt...' });
    await handleModelResponse(botMessage, async () => chat.sendMessageStream([messageContent, ...imageParts]), message);
  }
}

async function handleTextFileMessage(message) {
  let messageContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();

  const supportedMimeTypes = [
    'application/pdf', 'text/plain', 'text/html', 'text/css',
    'application/javascript', 'application/json', 'text/x-python',
    'application/x-yaml', 'text/markdown', 'application/xml'
  ];

  const supportedFileExtensions = [
    'md', 'yaml', 'yml', 'xml', 'env', 'sh', 'bat', 'rb', 'c', 'cpp', 'cc',
    'cxx', 'h', 'hpp', 'java'
  ];

  // Filter attachments for supported types and extensions
  const fileAttachments = message.attachments.filter((attachment) => {
    const fileMimeType = attachment.contentType?.split(';')[0].trim();
    const fileExtension = attachment.name.split('.').pop().toLowerCase();
    return supportedMimeTypes.includes(fileMimeType) || supportedFileExtensions.includes(fileExtension);
  });

  if (fileAttachments.size > 0) {
    let botMessage = await message.reply({ content: '> `Processing your document(s)...`' });
    let formattedMessage = messageContent;

    for (const [attachmentId, attachment] of fileAttachments) {
      let extractedText = await (attachment.contentType?.startsWith('application/pdf') ?
        extractTextFromPDF(attachment.url) :
        fetchTextContent(attachment.url));

      formattedMessage += `\n\n[${attachment.name}] File Content:\n"${extractedText}"`;
    }

    // Load the text model and handle the conversation
    const isServerChatHistoryEnabled = message.guild ? serverSettings[message.guild.id]?.serverChatHistory : false;
    const instructions = message.guild ?
      (serverSettings[message.guild.id]?.customServerPersonality && customInstructions[message.guild.id] ?
        customInstructions[message.guild.id] :
        customInstructions[message.author.id]) :
      customInstructions[message.author.id];
    const model = await genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction: { role: "system", parts: [{ text: instructions ? instructions : defaultPersonality }] } }, { apiVersion: 'v1beta' });
    const chat = model.startChat({
      history: isServerChatHistoryEnabled ? getHistory(message.guild.id) : getHistory(message.author.id),
      safetySettings,
    });

    await handleModelResponse(botMessage, () => chat.sendMessageStream(formattedMessage), message);
  }
}

async function handleTextMessage(message) {
  let botMessage;
  const userId = message.author.id;
  let messageContent = message.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim();
  if (messageContent === '') {
    const botMessage = await message.reply("It looks like you didn't say anything. What would you like to talk about?");
    await addSettingsButton(botMessage);
    return;
  }
  const instructions = message.guild ?
    (serverSettings[message.guild.id]?.customServerPersonality && customInstructions[message.guild.id] ?
      customInstructions[message.guild.id] :
      customInstructions[message.author.id]) :
    customInstructions[message.author.id];

  let formattedMessage = messageContent;

  const urls = extractUrls(messageContent);
  activeRequests.add(userId);
  const videoTranscripts = {};
  if (urls.length > 0 && getUrlUserPreference(userId) === "ON") {
    botMessage = await message.reply('Fetching content from the URLs...');
    await handleUrlsInMessage(urls, formattedMessage, botMessage, message);
  } else {
    botMessage = await message.reply('> `Let me think...`');
    const isServerChatHistoryEnabled = message.guild ? serverSettings[message.guild.id]?.serverChatHistory : false;
    // Only include instructions if they are set.
    const model = await genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction: { role: "system", parts: [{ text: instructions ? instructions : defaultPersonality }] } }, { apiVersion: 'v1beta' });
    const chat = model.startChat({
      history: isServerChatHistoryEnabled ? getHistory(message.guild.id) : getHistory(message.author.id),
      safetySettings,
    });
    await handleModelResponse(botMessage, () => chat.sendMessageStream(formattedMessage), message);
  }
}

// <==========>



// <=====[Interaction Reply 1 (Image/Speech Snd Video Gen)]=====>

async function handleImagineCommand(interaction) {
  try {
    const prompt = interaction.options.getString('prompt');
    const model = interaction.options.getString('model');
    const resolution = interaction.options.getString('resolution');
    if (resolution) {
      userPreferredImageResolution[interaction.user.id] = resolution;
    }
    await genimgslash(prompt, model, interaction);
  } catch (error) {
    console.log(error.message);
  }
}

async function handleSpeechCommand(interaction) {
  const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your speech, please wait... 💽` });
  try {
    const userId = interaction.user.id;
    const text = interaction.options.getString('prompt');
    const language = interaction.options.getString('language');
    const outputUrl = await generateSpeechWithPrompt(text, userId, language);
    if (outputUrl && outputUrl !== 'Output URL is not available.') {
      await handleSuccessfulSpeechGeneration(interaction, text, language, outputUrl);
      await generatingMsg.delete();
    } else {
      const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong, or the output URL is not available.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    }
  } catch (error) {
    console.log(error);
    try {
      const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong and the output is not available.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    } catch(error) {}
  }
}

async function handleMusicCommand(interaction) {
  const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your music, please wait... 🎧` });
  try {
    const userId = interaction.user.id;
    const text = interaction.options.getString('prompt');
    const outputUrl = await generateMusicWithPrompt(text, userId);
    if (outputUrl && outputUrl !== 'Output URL is not available.') {
      await handleSuccessfulMusicGeneration(interaction, text, outputUrl);
      await generatingMsg.delete();
    } else {
      const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong, or the output URL is not available.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    }
  } catch (error) {
    console.log(error);
    try {
      const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong and the output is not available.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    } catch(error) {}
  }
}

async function handleVideoCommand(interaction) {
  const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your video, please wait... 📽️` });
  try {
    const userId = interaction.user.id;
    const text = interaction.options.getString('prompt');
    const outputUrl = await generateVideoWithPrompt(text, userId);
    if (outputUrl && outputUrl !== 'Output URL is not available.') {
      await handleSuccessfulVideoGeneration(interaction, text, outputUrl);
      await generatingMsg.delete();
    } else {
      const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong, or the output URL is not available.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    }
  } catch (error) {
    console.log(error);
    try {
      const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong and the output is not available.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    } catch(error) {}
  }
}

async function handleSuccessfulSpeechGeneration(interaction, text, language, outputUrl) {
  try {
    const isGuild = interaction.guild !== null;
    const file = new AttachmentBuilder(outputUrl).setName('speech.wav');
    const embed = new EmbedBuilder()
      .setColor(0x505050)
      .setAuthor({ name: `To ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL() })
      .setDescription(`Here Is Your Generated Speech\n**Prompt:**\n\`\`\`${text.length > 3900 ? text.substring(0, 3900) + '...' : text}\`\`\``)
      .addFields(
        { name: '**Generated by**', value: `\`${interaction.user.displayName}\``, inline: true },
        { name: '**Language Used:**', value: `\`${language}\``, inline: true }
      )
      .setTimestamp();
    if (isGuild) {
      embed.setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || 'https://ai.google.dev/static/site-assets/images/share.png' });
    }

    const messageReference = await interaction.channel.send({ content: `${interaction.user}`, embeds: [embed], files: [file] });
    await addSettingsButton(messageReference);
  } catch (error) {
    console.log(error.message);
  }
}

async function handleSuccessfulMusicGeneration(interaction, text, outputUrl) {
  try {
    const isGuild = interaction.guild !== null;
    const file = new AttachmentBuilder(outputUrl).setName('music.mp4');
    const embed = new EmbedBuilder()
      .setColor(0x505050)
      .setAuthor({ name: `To ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL() })
      .setDescription(`Here Is Your Generated Music\n**Prompt:**\n\`\`\`${text.length > 3900 ? text.substring(0, 3900) + '...' : text}\`\`\``)
      .addFields(
        { name: '**Generated by**', value: `\`${interaction.user.displayName}\``, inline: true }
      )
      .setTimestamp();
    if (isGuild) {
      embed.setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || 'https://ai.google.dev/static/site-assets/images/share.png' });
    }

    const messageReference = await interaction.channel.send({ content: `${interaction.user}`, embeds: [embed], files: [file] });
    await addSettingsButton(messageReference);
  } catch (error) {
    console.log(error.message);
  }
}

async function handleSuccessfulVideoGeneration(interaction, text, outputUrl) {
  try {
    const isGuild = interaction.guild !== null;
    const file = new AttachmentBuilder(outputUrl).setName('video.mp4');
    const embed = new EmbedBuilder()
      .setColor(0x505050)
      .setAuthor({ name: `To ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL() })
      .setDescription(`Here Is Your Generated Video\n**Prompt:**\n\`\`\`${text.length > 3900 ? text.substring(0, 3900) + '...' : text}\`\`\``)
      .addFields(
        { name: '**Generated by**', value: `\`${interaction.user.displayName}\``, inline: true }
      )
      .setTimestamp();
    if (isGuild) {
      embed.setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || 'https://ai.google.dev/static/site-assets/images/share.png' });
    }

    const messageReference = await interaction.channel.send({ content: `${interaction.user}`, embeds: [embed], files: [file] });
    await addSettingsButton(messageReference);
  } catch (error) {
    console.log(error.message);
  }
}

async function handleGenerateImageButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('generate-image-modal')
    .setTitle('Generate An Image')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
        .setCustomId('image-prompt-input')
        .setLabel("Describe the image you'd like to generate:")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Enter your image description here")
        .setMinLength(1)
        .setMaxLength(2000)
      )
    );

  await interaction.showModal(modal);
}

async function processSpeechGet(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('text-speech-modal')
    .setTitle('Input your text');

  const textInput = new TextInputBuilder()
    .setCustomId('text-speech-input')
    .setLabel("What's your text?")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(3900);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));

  await interaction.showModal(modal);
}

async function processMusicGet(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('text-music-modal')
    .setTitle('Input your text');

  const textInput = new TextInputBuilder()
    .setCustomId('text-music-input')
    .setLabel("What's your text?")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(800);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));

  await interaction.showModal(modal);
}

async function processVideoGet(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('text-video-modal')
    .setTitle('Input your text');

  const textInput = new TextInputBuilder()
    .setCustomId('text-video-input')
    .setLabel("What's your text?")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(800);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));

  await interaction.showModal(modal);
}

async function genimg(prompt, message) {
  const generatingMsg = await message.reply({ content: `Generating your image, please wait... 🖌️` });

  try {
    const { imageResult, enhancedPrompt } = await generateImageWithPrompt(prompt, message.author.id);
    const imageUrl = imageResult.images[0].url; 
    const modelUsed = imageResult.modelUsed;
    const isGuild = message.guild !== null;
    const imageExtension = path.extname(imageUrl) || '.png';
    const attachment = new AttachmentBuilder(imageUrl, { name: `generated-image${imageExtension}` });
    const embed = new EmbedBuilder()
      .setColor(0x505050)
      .setAuthor({ name: `To ${message.author.displayName}`, iconURL: message.author.displayAvatarURL() })
      .setDescription(`Here Is Your Generated Image\n**Original Prompt:**\n\`\`\`${prompt.length > 3900 ? prompt.substring(0, 3900) + '...' : prompt}\`\`\``)
      .addFields(
        { name: '**Generated by:**', value: `\`${message.author.displayName}\``, inline: true },
        { name: '**Model Used:**', value: `\`${modelUsed}\``, inline: true },
        { name: '**Promot Enhancer:**', value: `\`${enhancedPrompt !== 'Disabled' ? 'Enabled' : 'Disabled'}\``, inline: true }
      )
      .setImage(`attachment://generated-image${imageExtension}`)
      .setTimestamp()
    if (enhancedPrompt !== 'Disabled') {
      let displayPrompt = enhancedPrompt;
      if (enhancedPrompt.length > 950) {
        displayPrompt = `${enhancedPrompt.slice(0, 947)}...`;
      }
      embed.addFields({ name: '**Enhanced Prompt:**', value: `\`\`\`${displayPrompt}\`\`\``, inline: false });
    }
    if (isGuild) {
      embed.setFooter({ text: message.guild.name, iconURL: message.guild.iconURL() || 'https://ai.google.dev/static/site-assets/images/share.png' });
    }

    const messageReference = await message.reply({ content: null, embeds: [embed], files: [attachment] });
    await addSettingsButton(messageReference);
    await generatingMsg.delete();
  } catch (error) {
    console.error(error);
    try {
      const messageReference = await message.reply({ content: `Sorry, could not generate the image. Please try again later.` });
      await addSettingsButton(messageReference);
      await generatingMsg.delete();
    } catch(error) {}
  }
}

async function genimgslash(prompt, modelInput, interaction) {
  const userId = interaction.user.id;
  const preferredModel = modelInput || userPreferredImageModel[userId] || defaultImgModel;

  if (modelInput) {
    userPreferredImageModel[userId] = modelInput;
  }

  const generatingMsg = await interaction.reply({ content: `Generating your image with ${preferredModel}, please wait... 🖌️` });

  try {
    await generateAndSendImage(prompt, interaction);
  } catch (error) {
    console.error(error);
    await handleImageGenerationError(interaction, generatingMsg);
    return;
  }

  await generatingMsg.delete();
}

async function handleImageGenerationError(interaction, generatingMsg) {
  try {
    const errorMsg = await interaction.channel.send({ content: `${interaction.user}, sorry, the image could not be generated. Please try again later.` });
    await addSettingsButton(errorMsg);
  } catch (err) {
    console.error("Error sending error message: ", err);
  } finally {
    await generatingMsg.delete();
  }
}

async function generateAndSendImage(prompt, interaction) {
  try {
    const { imageResult, enhancedPrompt } = await generateImageWithPrompt(prompt, interaction.user.id);
    const imageUrl = imageResult.images[0].url;
    const modelUsed = imageResult.modelUsed;
    const isGuild = interaction.guild !== null;
    const imageExtension = path.extname(imageUrl) || '.png';
    const attachment = new AttachmentBuilder(imageUrl, { name: `generated-image${imageExtension}` });
    
    const embed = new EmbedBuilder()
      .setColor(0x505050)
      .setAuthor({ name: `To ${interaction.user.displayName}`, iconURL: interaction.user.displayAvatarURL() })
      .setDescription(`Here Is Your Generated Image\n**Original Prompt:**\n\`\`\`${prompt.length > 3900 ? prompt.substring(0, 3900) + '...' : prompt}\`\`\``)
      .addFields(
        { name: '**Generated by:**', value: `\`${interaction.user.displayName}\``, inline: true },
        { name: '**Model Used:**', value: `\`${modelUsed}\``, inline: true },
        { name: '**Promot Enhancer:**', value: `\`${enhancedPrompt !== 'Disabled' ? 'Enabled' : 'Disabled'}\``, inline: true }
      )
      .setImage(`attachment://generated-image${imageExtension}`)
      .setTimestamp();
    if (enhancedPrompt !== 'Disabled') {
      let displayPrompt = enhancedPrompt;
      if (enhancedPrompt.length > 900) {
        displayPrompt = `${enhancedPrompt.slice(0, 897)}...`;
      }
      embed.addFields({ name: '**Enhanced Prompt:**', value: `\`\`\`${displayPrompt}\`\`\``, inline: false });
    }
    if (isGuild) {
      embed.setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() || 'https://ai.google.dev/static/site-assets/images/share.png' });
    }

    const messageReference = await interaction.channel.send({ content: `${interaction.user}`, embeds: [embed], files: [attachment] });
    await addSettingsButton(messageReference);
  } catch (error) {
    throw error;
  }
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === 'custom-personality-modal') {
    try {
      const customInstructionsInput = interaction.fields.getTextInputValue('custom-personality-input');
      customInstructions[interaction.user.id] = customInstructionsInput.trim();

      await interaction.reply({ content: '> Custom Personality Instructions Saved!', ephemeral: true });
    } catch (error) {
      console.log(error.message);
    }
  } else if (interaction.customId === 'custom-server-personality-modal') {
    try {
      const customInstructionsInput = interaction.fields.getTextInputValue('custom-server-personality-input');
      customInstructions[interaction.guild.id] = customInstructionsInput.trim();

      await interaction.reply({ content: 'Custom Server Personality Instructions Saved!', ephemeral: true });
    } catch (error) {
      console.log(error.message);
    }
  } else if (interaction.customId === 'text-speech-modal') {
    const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your speech, please wait... 💽` });
    try {
      const userId = interaction.user.id;
      const text = interaction.fields.getTextInputValue('text-speech-input');
      const outputUrl = await generateSpeechWithPrompt(text, userId, 'en');
      if (outputUrl && outputUrl !== 'Output URL is not available.') {
        await handleSuccessfulSpeechGeneration(interaction, text, "English", outputUrl);
        await generatingMsg.delete();
      } else {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong or the output URL is not available.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      }
    } catch (error) {
      console.log(error);
      try {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong or the output URL is not available.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      } catch(error) {}
    }
  } else if (interaction.customId === 'text-music-modal') {
    const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your music, please wait... 🎧` });
    try {
      const userId = interaction.user.id;
      const text = interaction.fields.getTextInputValue('text-music-input');
      const outputUrl = await generateMusicWithPrompt(text, userId);
      if (outputUrl && outputUrl !== 'Output URL is not available.') {
        await handleSuccessfulMusicGeneration(interaction, text, outputUrl);
        await generatingMsg.delete();
      } else {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong or the output URL is not available.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      }
    } catch (error) {
      console.log(error);
      try {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong or the output URL is not available.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      } catch(error) {}
    }
  } else if (interaction.customId === 'text-video-modal') {
    const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your video, please wait... 📽️` });
    try {
      const userId = interaction.user.id;
      const text = interaction.fields.getTextInputValue('text-video-input');
      const outputUrl = await generateVideoWithPrompt(text, userId);
      if (outputUrl && outputUrl !== 'Output URL is not available.') {
        await handleSuccessfulVideoGeneration(interaction, text, outputUrl);
        await generatingMsg.delete();
      } else {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong or the output URL is not available.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      }
    } catch (error) {
      console.log(error);
      try {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, something went wrong or the output URL is not available.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      } catch(error) {}
    }
  } else if (interaction.customId === 'generate-image-modal') {
    const prompt = interaction.fields.getTextInputValue('image-prompt-input');

    const generatingMsg = await interaction.reply({ content: `${interaction.user}, generating your image, please wait... 🖌️` });

    try {
      await generateAndSendImage(prompt, interaction);
      await generatingMsg.delete();
    } catch (error) {
      console.log(error);
      try {
        const messageReference = await interaction.channel.send({ content: `${interaction.user}, sorry, could not generate the image. Please try again later.` });
        await addSettingsButton(messageReference);
        await generatingMsg.delete();
      } catch(error) {}
    }
  }
}

async function changeImageModel(interaction) {
  try {
    // Define model names in an array
    const models = [
      'SD-XL', 'Playground', 'Anime', 'Stable-Cascade', 'DallE-XL', 'PixArt-Sigma', 'Mobius'/*, 'DallE-3'*/
      ];
    
    const selectedModel = userPreferredImageModel[interaction.user.id] || defaultImgModel;

    // Create a select menu
    let selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select-image-model')
      .setPlaceholder('Select Image Generation Model')
      .setMinValues(1)
      .setMaxValues(1);

    // Add options to select menu
    models.forEach((model) => {
      selectMenu.addOptions([
        {
          label: model,
          value: model,
          description: `Select to use ${model} model.`,
          default: model === selectedModel,
        },
      ]);
    });

    // Create an action row and add the select menu to it
    const actionRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      content: '> `Select Image Generation Model:`',
      components: [actionRow],
      ephemeral: true
    });
  } catch (error) {
    console.log(error.message);
  }
}

async function changeImageResolution(interaction) {
  try {
    const userId = interaction.user.id;
    const selectedModel = userPreferredImageModel[userId];
    let supportedResolution;
    const supportedModels = ['DallE-XL', 'Anime', 'Stable-Cascade', 'Playground', 'SD-XL', 'PixArt-Sigma', 'Mobius'];
    if (supportedModels.includes(selectedModel)) {
      supportedResolution = ['Square', 'Portrait', 'Wide'];
    } else {
      supportedResolution = ['Square'];
    }
    
    const selectedResolution = userPreferredImageResolution[userId] || 'Square';

    // Create a select menu
    let selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select-image-resolution')
      .setPlaceholder('Select Image Generation Resolution')
      .setMinValues(1)
      .setMaxValues(1);

    // Add options to select menu based on the supported resolutions
    supportedResolution.forEach((resolution) => {
      selectMenu.addOptions([{
        label: resolution,
        value: resolution,
        description: `Generate images in ${resolution} resolution.`,
        default: resolution === selectedResolution,
      }]);
    });

    // Create an action row and add the select menu to it
    const actionRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      content: '> `Select Image Generation Resolution:`',
      components: [actionRow],
      ephemeral: true
    });
  } catch (error) {
    console.log(error.message);
  }
}

async function changeSpeechModel(interaction) {
  // Define model numbers in an array
  const modelNumbers = ['1'];

  // Generate buttons using map()
  const buttons = modelNumbers.map(number =>
    new ButtonBuilder()
    .setCustomId(`select-speech-model-${number}`)
    .setLabel(number)
    .setStyle(ButtonStyle.Primary)
  );

  const actionRows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const actionRow = new ActionRowBuilder().addComponents(buttons.slice(i, i + 5));
    actionRows.push(actionRow);
  }

  await interaction.reply({
    content: '> `Select Speech Generation Model:`',
    components: actionRows,
    ephemeral: true
  });
}

const speechMusicVideoModelFunctions = {
  '1': speechGen,
  'MusicGen': musicGen,
  'VideoGen': videoGen
};

const imageModelFunctions = {
  'SD-XL': generateWithSDXL,
  'Playground': generateWithPlayground,
  'Anime': generateWithAnime,
  'Stable-Cascade': generateWithSC,
  'DallE-XL': generateWithDallEXL,
  'DallE-3': generateWithDalle3,
  'PixArt-Sigma': generateWithPixArt_Sigma,
  'Mobius': generateWithMobius
};

async function handleImageSelectModel(interaction, model) {
  try {
    const userId = interaction.user.id;
    userPreferredImageModel[userId] = model;
    await interaction.reply({ content: `**Image Generation Model Selected**: ${model}`, ephemeral: true });
  } catch (error) {
    console.log(error.message);
  }
}

async function handleImageSelectResolution(interaction, resolution) {
  try {
    const userId = interaction.user.id;
    userPreferredImageResolution[userId] = resolution;
    await interaction.reply({ content: `**Image Generation Resolution Selected**: ${resolution}`, ephemeral: true });
  } catch (error) {
    console.log(error.message);
  }
}

async function handleSpeechSelectModel(interaction, model) {
  try {
    const userId = interaction.user.id;
    userPreferredSpeechModel[userId] = model;
    await interaction.reply({ content: `**Speech Generation Model Selected**: ${model}`, ephemeral: true });
  } catch(error) {
    console.log(error.message);
  }
}

async function togglePromptEnhancer(interaction) {
  try {
    const userId = interaction.user.id;
    if (userPreferredImagePromptEnhancement[userId] === undefined) {
      userPreferredImagePromptEnhancement[userId] = true;
    }
    userPreferredImagePromptEnhancement[userId] = !userPreferredImagePromptEnhancement[userId];
    const newState = userPreferredImagePromptEnhancement[userId] ? 'Enabled' : 'Disabled';
    await interaction.reply({ content: `Prompt Enhancer is now ${newState}.`, ephemeral: true });
  } catch (error) {
    console.error(`Error toggling Prompt Enhancer: ${error.message}`);
  }
}

const diffusionMaster = require('./diffusionMasterPrompt');

async function enhancePrompt(prompt) {
  const retryLimit = 3;
  let currentAttempt = 0;
  let error;

  while (currentAttempt < retryLimit) {
    try {
      currentAttempt += 1;
      console.log(`Attempt ${currentAttempt}`);

      let response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Request timed out'));
        }, 15000);

        const payload = {
          model: "llama3-70b-8192",
          stream: false,
          messages: [
            {
              role: "system",
              content: diffusionMaster
            },
            {
              role: "user",
              content: prompt
            }
          ]
        };

        const headers = {
          "Content-Type": "application/json"
        };
        if (process.env.OPENAI_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
        }


        const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        axios.post(`${baseURL}/chat/completions`, payload, { headers: headers })
          .then(response => {
            clearTimeout(timeout);
            resolve(response);
          })
          .catch(err => {
            clearTimeout(timeout);
            reject(err);
          });
      });

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        let content = response.data.choices[0].message.content;
        const codeBlockPattern = /```([^`]+)```/s;
        const match = content.match(codeBlockPattern);
        if (match) {
          content = match[1].trim();
        } else {
          throw new Error(`Enhanced prompt not found`);
        }
        console.log(content);
        return content;
      } else {
        console.log('Error processing response data');
        error = new Error('Error processing response data');
      }
    } catch (err) {
      console.error(err.message);
      error = err;
    }
  }
  if (error) {
    console.error('Retries exhausted or an error occurred:', error.message);
  }
  return prompt;
}

async function enhancePrompt1(prompt, attempts = 3) {
  const generate = async () => {
    const model = await genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction: { role: "system", parts: [{ text: diffusionMaster }] } }, { apiVersion: 'v1beta' });
    const result = await model.generateContent(prompt);
    return result.response.text();
  };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const textResponse = await Promise.race([
        generate(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
      ]);

      let content = textResponse;
      const codeBlockPattern = /```([^`]+)```/s;
      const match = content.match(codeBlockPattern);
      if (match) {
        content = match[1].trim();
      } else {
        throw new Error(`Enhanced prompt not found`);
      }
      return content;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === attempts) {
        console.log('All attempts failed, returning the original prompt.');
        return prompt;
      }
    }
  }
}

async function generateImageWithPrompt(prompt, userId) {
  try {
    const selectedModel = userPreferredImageModel[userId] || defaultImgModel;
    const generateFunction = imageModelFunctions[selectedModel];
    const resolution = userPreferredImageResolution[userId] || 'Square';
    if (userPreferredImagePromptEnhancement[userId] === undefined) {
      userPreferredImagePromptEnhancement[userId] = true;
    }
    if (!generateFunction) {
      throw new Error(`Unsupported model: ${selectedModel}`);
    }

    let finalPrompt = filterPrompt(prompt);
    let enhancedPromptStatus;

    if (userPreferredImagePromptEnhancement[userId]) {
      finalPrompt = await enhancePrompt(finalPrompt);
      enhancedPromptStatus = finalPrompt;
    } else {
      enhancedPromptStatus = 'Disabled';
    }
    const imageResult = await retryOperation(() => generateFunction(finalPrompt, resolution), 3);
    return {
      imageResult,
      enhancedPrompt: enhancedPromptStatus
    };
  } catch (error) {
    console.error('Error generating image:', error);
    throw new Error('Could not generate image after retries');
  }
}

async function generateSpeechWithPrompt(prompt, userId, language) {
  try {
    const selectedModel = userPreferredSpeechModel[userId] || "1";
    const generateFunction = speechMusicVideoModelFunctions[selectedModel];

    if (!generateFunction) {
      throw new Error(`Unsupported speech model: ${selectedModel}`);
    }
    return await retryOperation(() => generateFunction(prompt, language), 3);
  } catch (error) {
    console.error('Error generating speech:', error.message);
    throw new Error('Could not generate speech after retries');
  }
}

async function generateMusicWithPrompt(prompt, userId) {
  try {
    const selectedModel = "MusicGen";
    const generateFunction = speechMusicVideoModelFunctions[selectedModel];

    if (!generateFunction) {
      throw new Error(`Unsupported music model: ${selectedModel}`);
    }
    return await retryOperation(() => generateFunction(prompt), 3);
  } catch (error) {
    console.error('Error generating music:', error.message);
    throw new Error('Could not generate msuic after retries');
  }
}

async function generateVideoWithPrompt(prompt, userId) {
  try {
    const selectedModel = "VideoGen";
    const generateFunction = speechMusicVideoModelFunctions[selectedModel];
    if (userPreferredImagePromptEnhancement[userId] === undefined) {
      userPreferredImagePromptEnhancement[userId] = true;
    }
    if (!generateFunction) {
      throw new Error(`Unsupported music model: ${selectedModel}`);
    }
    let finalPrompt = filterPrompt(prompt);
    if (userPreferredImagePromptEnhancement[userId]) {
      finalPrompt = await enhancePrompt(finalPrompt);
    }
    return await retryOperation(() => generateFunction(finalPrompt), 3);
  } catch (error) {
    console.error('Error generating music:', error.message);
    throw new Error('Could not generate msuic after retries');
  }
}

// <==========>



// <=====[Interaction Reply 2 (Others)]=====>

async function clearChatHistory(interaction) {
  try {
    chatHistories[interaction.user.id] = [];
    await interaction.reply({ content: '> `Chat history cleared!`', ephemeral: true });
  } catch (error) {
    console.log(error.message);
  }
}

async function alwaysRespond(interaction) {
  try {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.channel.type === ChannelType.DM) {
      await interaction.reply({ content: '> `This feature is disabled in DMs.`', ephemeral: true });
      return;
    }

    if (!activeUsersInChannels[channelId]) {
      activeUsersInChannels[channelId] = {};
    }

    if (activeUsersInChannels[channelId][userId]) {
      delete activeUsersInChannels[channelId][userId];
      await interaction.reply({ content: '> Bot response to your messages is turned `OFF`.', ephemeral: true });
    } else {
      activeUsersInChannels[channelId][userId] = true;
      await interaction.reply({ content: '> Bot response to your messages is turned `ON`.', ephemeral: true });
    }
  } catch (error) {
    console.log(error.message);
  }
}

async function handleRespondToAllCommand(interaction) {
  try {
    if (interaction.channel.type === ChannelType.DM) {
      return interaction.reply({ content: 'This command cannot be used in DMs.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need to be an admin to use this command.', ephemeral: true });
    }

    const channelId = interaction.channelId;
    if (alwaysRespondChannels[channelId]) {
      delete alwaysRespondChannels[channelId];
      await interaction.reply({ content: '> **The bot will now stop** responding to all messages in this channel.', ephemeral: false });
    } else {
      alwaysRespondChannels[channelId] = true;
      await interaction.reply({ content: '> **The bot will now respond** to all messages in this channel.', ephemeral: false });
    }
  } catch (error) {
    console.log(error.message);
  }
}

function initializeBlacklistForGuild(guildId) {
  try {
    if (!blacklistedUsers[guildId]) {
      blacklistedUsers[guildId] = [];
    }
    if (!serverSettings[guildId]) {
      serverSettings[guildId] = defaultServerSettings;
    }
  } catch(error) {}
}

async function handleBlacklistCommand(interaction) {
  try {
    if (interaction.channel.type === ChannelType.DM) {
      return interaction.reply({ content: 'This command cannot be used in DMs.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need to be an admin to use this command.', ephemeral: true });
    }
    const userId = interaction.options.getUser('user').id;

    // Add the user to the blacklist if not already present
    initializeBlacklistForGuild(interaction.guild.id);
    if (!blacklistedUsers[interaction.guild.id].includes(userId)) {
      blacklistedUsers[interaction.guild.id].push(userId);
      await interaction.reply(`<@${userId}> has been blacklisted.`);
    } else {
      await interaction.reply(`<@${userId}> is already blacklisted.`);
    }
  } catch(error) {
    console.log(error.message);
  }
}

async function handleWhitelistCommand(interaction) {
  try {
    if (interaction.channel.type === ChannelType.DM) {
      return interaction.reply({ content: 'This command cannot be used in DMs.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'You need to be an admin to use this command.', ephemeral: true });
    }
    const userId = interaction.options.getUser('user').id;

    // Remove the user from the blacklist if present
    initializeBlacklistForGuild(interaction.guild.id);
    const index = blacklistedUsers[interaction.guild.id].indexOf(userId);
    if (index > -1) {
      blacklistedUsers[interaction.guild.id].splice(index, 1);
      await interaction.reply(`<@${userId}> has been removed from the blacklist.`);
    } else {
      await interaction.reply(`<@${userId}> is not in the blacklist.`);
    }
  } catch(error) {
    console.log(error.message);
  }
}

async function setCustomPersonality(interaction) {
  const customId = 'custom-personality-input';
  const title = 'Enter Custom Personality Instructions';

  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel("What should the bot's personality be like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Enter the custom instructions here...")
    .setMinLength(10)
    .setMaxLength(4000);

  const modal = new ModalBuilder()
    .setCustomId('custom-personality-modal')
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));

  // Present the modal to the user
  await interaction.showModal(modal);
}

async function downloadMessage(interaction) {
  try {
    const userId = interaction.user.id;
    const message = interaction.message;
    let textContent = message.content;
    if (!textContent && message.embeds.length > 0) {
      textContent = message.embeds[0].description;
    }

    if (!textContent) {
      await interaction.reply({ content: '> `The message is empty..?`', ephemeral: true });
      return;
    }

    const filePath = path.resolve(__dirname, `message_content_${userId}.txt`);
    fs.writeFileSync(filePath, textContent, 'utf8');

    const attachment = new AttachmentBuilder(filePath, { name: 'message_content.txt' });

    if (interaction.channel.type === ChannelType.DM) {
      await interaction.reply({ content: '> `Here is the content of the message:`', files: [attachment] });
    } else {
      try {
        await interaction.user.send({ content: '> `Here is the content of the message:`', files: [attachment] });
        await interaction.reply({ content: '> `The message content has been sent to your DMs.`', ephemeral: true });
      } catch (error) {
        console.error(`Failed to send DM: ${error}`);
        await interaction.reply({ content: '> `Here is the content of the message:`', files: [attachment], ephemeral: true });
      }
    }

    fs.unlinkSync(filePath);
  } catch (error) {
    console.log(error.message);
  }
}

async function downloadConversation(interaction) {
  try {
    const userId = interaction.user.id;
    const conversationHistory = chatHistories[userId];

    if (!conversationHistory || conversationHistory.length === 0) {
      await interaction.reply({ content: '> `No conversation history found.`', ephemeral: true });
      return;
    }

    let conversationText = '';
    for (let i = 0; i < conversationHistory.length; i++) {
      const speaker = i % 2 === 0 ? '[User]' : '[Model]';
      conversationText += `${speaker}:\n${conversationHistory[i]}\n\n`;
    }

    const tempFileName = path.join(__dirname, `${userId}_conversation.txt`);
    fs.writeFileSync(tempFileName, conversationText, 'utf8');

    const file = new AttachmentBuilder(tempFileName, { name: 'conversation_history.txt' });

    if (interaction.channel.type === ChannelType.DM) {
      await interaction.reply({ content: '> `Here\'s your conversation history:`', files: [file] });
    } else {
      try {
        await interaction.user.send({ content: '> `Here\'s your conversation history:`', files: [file] });
        await interaction.reply({ content: '> `Your conversation history has been sent to your DMs.`', ephemeral: true });
      } catch (error) {
        console.error(`Failed to send DM: ${error}`);
        await interaction.reply({ content: '> `Here\'s your conversation history:`', files: [file], ephemeral: true });
      }
    }

    fs.unlinkSync(tempFileName);
  } catch (error) {
    console.log(error.message);
  }
}

async function removeCustomPersonality(interaction) {
  try {
    delete customInstructions[interaction.user.id];
    await interaction.reply({ content: "> `Custom personality instructions removed!`", ephemeral: true });
  } catch (error) {
    console.log(error.message);
  }
}

async function toggleUrlUserPreference(interaction) {
  try {
    const userId = interaction.user.id;
    const currentPreference = getUrlUserPreference(userId);
    userPreferredUrlHandle[userId] = currentPreference === 'OFF' ? 'ON' : 'OFF';
    const updatedPreference = getUrlUserPreference(userId);
    await interaction.reply({ content: `> **URL handling has been switched from \`${currentPreference}\` to \`${updatedPreference}\`.**`, ephemeral: true });
  } catch (error) {
    console.log(error.message);
  }
}

// Function to toggle user preference
async function toggleUserPreference(interaction) {
  try {
    const userId = interaction.user.id;
    const currentPreference = getUserPreference(userId);
    userResponsePreference[userId] = currentPreference === 'normal' ? 'embedded' : 'normal';
    const updatedPreference = getUserPreference(userId);
    await interaction.reply({ content: `> **Your responses has been switched from \`${currentPreference}\` to \`${updatedPreference}\`.**`, ephemeral: true });
  } catch (error) {
    console.log(error.message);
  }
}

async function toggleServerWideChatHistory(interaction) {
  try {
    if (!interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }
    const serverId = interaction.guild.id;
    serverSettings[serverId].serverChatHistory = !serverSettings[serverId].serverChatHistory;
    await interaction.reply({content: `Server-wide Chat History Is Now \`${serverSettings[serverId].serverChatHistory}\`` , ephemeral: true});

  } catch (error) {
    console.log(error.message);
  }
}

async function toggleServerPersonality(interaction) {
  try {
    if (!interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }
    const serverId = interaction.guild.id;
    serverSettings[serverId].customServerPersonality = !serverSettings[serverId].customServerPersonality;
    await interaction.reply({content: `Server-wide Personality Is Now \`${serverSettings[serverId].customServerPersonality}\`` , ephemeral: true});

  } catch (error) {
    console.log(error.message);
  }
}

async function toggleServerResponsePreference(interaction) {
  try {
    if (!interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }
    const serverId = interaction.guild.id;
    serverSettings[serverId].serverResponsePreference = !serverSettings[serverId].serverResponsePreference;
    await interaction.reply({content: `Server-wide Response Following Is Now \`${serverSettings[serverId].serverResponsePreference}\`` , ephemeral: true});

  } catch (error) {
    console.log(error.message);
  }
}

async function toggleSettingSaveButton(interaction) {
  try {
    if (!interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }
    const serverId = interaction.guild.id;
    serverSettings[serverId].settingsSaveButton = !serverSettings[serverId].settingsSaveButton;
    await interaction.reply({content: `Server-wide "Settings And Save Button" Is Now \`${serverSettings[serverId].settingsSaveButton}\`` , ephemeral: true});

  } catch (error) {
    console.log(error.message);
  }
}

async function serverPersonality(interaction) {
  const customId = 'custom-server-personality-input';
  const title = 'Enter Custom Personality Instructions';

  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel("What should the bot's personality be like?")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Enter the custom instructions here...")
    .setMinLength(10)
    .setMaxLength(4000);

  const modal = new ModalBuilder()
    .setCustomId('custom-server-personality-modal')
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));

  // Present the modal to the user
  await interaction.showModal(modal);
}

async function clearServerChatHistory(interaction) {
  try {
    if (!interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }
    if (serverSettings[interaction.guild.id].serverChatHistory) {
      chatHistories[interaction.guild.id] = [];
      await interaction.reply({ content: 'Server-Wide Chat History Cleared!', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Server-Wide Chat History Is Disabled For This Server.', ephemeral: true });
    }
  } catch (error) {
    console.log(error.message);
  }
}

async function downloadServerConversation(interaction) {
  try {
    const guild = interaction.guild.id;
    const conversationHistory = chatHistories[guild];

    if (!conversationHistory || conversationHistory.length === 0) {
      await interaction.reply({ content: '> `No conversation history found.`', ephemeral: true });
      return;
    }

    let conversationText = '';
    for (let i = 0; i < conversationHistory.length; i++) {
      const speaker = i % 2 === 0 ? '[User]' : '[Model]';
      conversationText += `${speaker}:\n${conversationHistory[i]}\n\n`;
    }

    const tempFileName = path.join(__dirname, `${userId}_conversation.txt`);
    fs.writeFileSync(tempFileName, conversationText, 'utf8');

    const file = new AttachmentBuilder(tempFileName, { name: 'conversation_history.txt' });

    if (interaction.channel.type === ChannelType.DM) {
      await interaction.reply({ content: '> `Here\'s your conversation history:`', files: [file] });
    } else {
      try {
        await interaction.user.send({ content: '> `Here\'s The Server-Wide conversation history:`', files: [file] });
        await interaction.reply({ content: '> `Server-Wide conversation history has been sent to your DMs.`', ephemeral: true });
      } catch (error) {
        console.error(`Failed to send DM: ${error}`);
        await interaction.reply({ content: '> `Here\'s The Server-Wide conversation history:`', files: [file], ephemeral: true });
      }
    }

    fs.unlinkSync(tempFileName);
  } catch (error) {
    console.log(error.message);
  }
}

async function toggleServerPreference(interaction) {
  try {
    const guildId = interaction.guild.id;
    if (serverSettings[guildId].responseStyle === "embedded") {
      serverSettings[guildId].responseStyle = "normal";
    } else {
      serverSettings[guildId].responseStyle = "embedded";
    }
    await interaction.reply({ content: `Server response style updated to: ${serverSettings[guildId].responseStyle}`, ephemeral: true});
  } catch (error) {
    console.log(error.message);
  }
}

async function showSettings(interaction) {
  if (interaction.guild) {
    initializeBlacklistForGuild(interaction.guild.id);
    if (blacklistedUsers[interaction.guild.id].includes(interaction.user.id)) {
      return interaction.reply({ content: 'You are blacklisted and cannot use this interaction.', ephemeral: true });
    }
  }
  // Define button configurations in an array
  const buttonConfigs = [
    {
      customId: "clear",
      label: "Clear Memory",
      emoji: "🧹",
      style: ButtonStyle.Danger,
    },
    {
      customId: "custom-personality",
      label: "Custom Personality",
      emoji: "🙌",
      style: ButtonStyle.Primary,
    },
    {
      customId: "remove-personality",
      label: "Remove Personality",
      emoji: "🤖",
      style: ButtonStyle.Danger,
    },
    {
      customId: "generate-image",
      label: "Generate Image",
      emoji: "🎨",
      style: ButtonStyle.Primary,
    },
    {
      customId: "change-image-model",
      label: "Change Image Model",
      emoji: "👨‍🎨",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "toggle-prompt-enhancer",
      label: "Toggle Prompt Enhancer",
      emoji: "🪄",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "change-image-resolution",
      label: "Change Image Resolution",
      emoji: "🖼️",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "generate-speech",
      label: "Generate Speech",
      emoji: "🎤",
      style: ButtonStyle.Primary,
    },
    {
      customId: "change-speech-model",
      label: "Change Speech Model",
      emoji: "🔈",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "generate-music",
      label: "Generate Music",
      emoji: "🎹",
      style: ButtonStyle.Primary,
    },
    {
      customId: "generate-video",
      label: "Generate Video",
      emoji: "📹",
      style: ButtonStyle.Primary,
    },
    {
      customId: "always-respond",
      label: "Always Respond",
      emoji: "↩️",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "toggle-response-mode",
      label: "Toggle Response Mode",
      emoji: "📝",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "toggle-url-mode",
      label: "Toggle URL Mode",
      emoji: "🌐",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "download-conversation",
      label: "Download Conversation",
      emoji: "🗃️",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "exit",
      label: "Exit Settings",
      emoji: "✖",
      style: ButtonStyle.Danger,
    },
  ];

  // Generate buttons from configurations
  const allButtons = buttonConfigs.map((config) =>
    new ButtonBuilder()
      .setCustomId(config.customId)
      .setLabel(config.label)
      .setEmoji(config.emoji)
      .setStyle(config.style)
  );

  // Split buttons into action rows
  const actionRows = [];
  while (allButtons.length > 0) {
    actionRows.push(
      new ActionRowBuilder().addComponents(allButtons.splice(0, 5))
    );
  }

  // Reply to the interaction
  let secondsLeft = 30;
  const countdownMessage = `> **This Message Will Get Deleted In: ${secondsLeft}s**\n> \`\`\`Settings:\`\`\``;

  await interaction.reply({
    content: countdownMessage,
    components: actionRows,
  });
  const countdownInterval = setInterval(async () => {
    secondsLeft--;
    if (secondsLeft > 0) {
      try {
        await interaction.editReply({
          content: `> **This Message Will Get Deleted In: ${secondsLeft}s**\n> \`\`\`Settings:\`\`\``,
          components: actionRows,
        });
      } catch (error) {
        clearInterval(countdownInterval);
      }
    } else {
      clearInterval(countdownInterval);
      try {
        interaction.deleteReply();
      } catch (error) {}
    }
  }, 1000);
}

async function showDashboard(interaction) {
  if (interaction.channel.type === ChannelType.DM) {
    return interaction.reply({ content: 'This command cannot be used in DMs.', ephemeral: true });
  }
  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: 'You need to be an admin to use this command.', ephemeral: true });
  }
  initializeBlacklistForGuild(interaction.guild.id);
  // Define button configurations in an array
  const buttonConfigs = [
    {
      customId: "server-chat-history",
      label: "Toggle Server-Wide Conversation History",
      emoji: "📦",
      style: ButtonStyle.Primary,
    },
    {
      customId: "clear-server",
      label: "Clear Server-Wide Memory",
      emoji: "🧹",
      style: ButtonStyle.Danger,
    },
    {
      customId: "settings-save-buttons",
      label: "Toggle Add Settings And Save Button",
      emoji: "🔘",
      style: ButtonStyle.Primary,
    },
    {
      customId: "toggle-server-personality",
      label: "Toggle Server Personality",
      emoji: "🤖",
      style: ButtonStyle.Primary,
    },
    {
      customId: "custom-server-personality",
      label: "Custom Server Personality",
      emoji: "🙌",
      style: ButtonStyle.Primary,
    },
    {
      customId: "toggle-response-server-mode",
      label: "Toggle Server-Wide Responses Style",
      emoji: "✏️",
      style: ButtonStyle.Primary,
    },
    {
      customId: "response-server-mode",
      label: "Server-Wide Responses Style",
      emoji: "📝",
      style: ButtonStyle.Secondary,
    },
    {
      customId: "download-server-conversation",
      label: "Download Server Conversation",
      emoji: "🗃️",
      style: ButtonStyle.Secondary,
    }
  ];

  // Generate buttons from configurations
  const allButtons = buttonConfigs.map((config) =>
    new ButtonBuilder()
      .setCustomId(config.customId)
      .setLabel(config.label)
      .setEmoji(config.emoji)
      .setStyle(config.style)
  );

  // Split buttons into action rows
  const actionRows = [];
  while (allButtons.length > 0) {
    actionRows.push(
      new ActionRowBuilder().addComponents(allButtons.splice(0, 5))
    );
  }

  // Reply to the interaction with settings buttons, without any countdown message
  await interaction.reply({
    content: "> ```Dashboard:```",
    components: actionRows,
    ephemeral: true
  });
}

// <==========>



// <=====[Others]=====>

async function addDownloadButton(botMessage) {
  try {
    const settingsButton = new ButtonBuilder()
      .setCustomId('settings')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary);

    const downloadButton = new ButtonBuilder()
      .setCustomId('download_message')
      .setLabel('Save')
      .setEmoji('⬇️')
      .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder().addComponents(settingsButton, downloadButton);
    await botMessage.edit({ components: [actionRow] });
  } catch (error) {
    console.log(error.message);
  }
}

async function addSettingsButton(botMessage) {
  try {
    const settingsButton = new ButtonBuilder()
      .setCustomId('settings')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder().addComponents(settingsButton);
    await botMessage.edit({ components: [actionRow] });
  } catch (error) {
    console.log(error.message);
  }
}

// Function to get user preference
function getUserPreference(userId) {
  return userResponsePreference[userId] || defaultResponseFormat;
}

function getUrlUserPreference(userId) {
  return userPreferredUrlHandle[userId] || defaultUrlReading;
}

// Function to extract text from a PDF file
async function extractTextFromPDF(pdfUrl) {
  try {
    const response = await fetch(pdfUrl);
    const pdfBuffer = await response.buffer();
    const data = await pdf(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error(error.message);
    throw new Error('Could not extract text from PDF');
  }
}

// Function to fetch text from a plaintext file
async function fetchTextFile(url) {
  try {
    const response = await fetch(url);
    return await response.text();
  } catch (error) {
    console.error('Error fetching text file:', error);
    throw new Error('Could not fetch text from file');
  }
}

function hasTextFileAttachments(message) {
  const supportedMimeTypes = [
    'application/pdf', 'text/plain', 'text/html', 'text/css',
    'application/javascript', 'text/x-python', 'application/json',
    'application/x-yaml', 'text/markdown', 'application/xml'
  ];

  const supportedFileExtensions = [
    'md', 'yaml', 'yml', 'xml', 'env', 'sh', 'bat', 'rb', 'c', 'cpp', 'cc',
    'cxx', 'h', 'hpp', 'java'
  ];

  return message.attachments.some((attachment) => {
    const fileMimeType = attachment.contentType?.split(';')[0].trim();
    const fileExtension = attachment.name.split('.').pop().toLowerCase();

    return supportedMimeTypes.includes(fileMimeType) || supportedFileExtensions.includes(fileExtension);
  });
}

async function fetchTextContent(url) {
  try {
    const response = await fetch(url);
    return await response.text();
  } catch (error) {
    console.error('Error fetching text content:', error);
    throw new Error('Could not fetch text content from file');
  }
}

async function scrapeWebpageContent(url) {
  try {
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 5000);
    });
    const response = await Promise.race([
      fetch(url),
      timeoutPromise
    ]);
    const html = await response.text();
    const $ = cheerio.load(html);
    $('script, style').remove();
    let bodyText = $('body').text();
    bodyText = bodyText.replace(/<[^>]*>?/gm, '');
    return bodyText.trim();
  } catch (error) {
    console.error('Error:', error);
    if (error.message === 'Timeout') {
      return "ERROR: The website is not responding..";
    } else {
      throw new Error('Could not scrape content from webpage');
    }
  }
}

async function handleUrlsInMessage(urls, messageContent, botMessage, originalMessage) {
  const model = await genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }, { apiVersion: 'v1beta' });
  const isServerChatHistoryEnabled = originalMessage.guild ? serverSettings[originalMessage.guild.id]?.serverChatHistory : false;
  const chat = model.startChat({
    history: isServerChatHistoryEnabled ? getHistory(originalMessage.guild.id) : getHistory(originalMessage.author.id),
    safetySettings,
  });

  let contentIndex = 1;
  let contentWithUrls = messageContent;
  for (const url of urls) {
    try {
      if (url.includes('youtu.be') || url.includes('youtube.com')) {
        const videoId = extractYouTubeVideoId(url);
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoId);
        const transcriptText = transcriptData.map(item => item.text).join(' ');
        contentWithUrls += `\n\n[Transcript Of Video ${url}]:\n"${transcriptText}"`;
      } else {
        // For non-video URLs, attempt to scrape webpage content
        const webpageContent = await scrapeWebpageContent(url);
        contentWithUrls += `\n\n[Text Inside The Website ${url}]:\n"${webpageContent}"`;
      }
      // In both cases, replace the URL with a reference in the text
      contentWithUrls = contentWithUrls.replace(url, `[Reference Number ${contentIndex}](${url})`);
      contentIndex++;
    } catch (error) {
      console.error('Error handling URL:', error);
      contentWithUrls += `\n\n[Error]: Can't access content from the [URL ${contentIndex}](${url}), likely due to bot blocking. Mention if you were blocked in your reply.`;
    }
  }
  // After processing all URLs, continue with the chat response
  await handleModelResponse(botMessage, () => chat.sendMessageStream(contentWithUrls), originalMessage);
}

function extractYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);

  return (match && match[2].length === 11) ? match[2] : null;
}

function extractUrls(text) {
  return text.match(/\bhttps?:\/\/\S+/gi) || [];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const safetySettings = [{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE, }, { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE, }, { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE, }, { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE, }, ];

// <==========>



// <=====[Model Response Handling]=====>

async function handleModelResponse(botMessage, responseFunc, originalMessage) {
  const userId = originalMessage.author.id;
  const userPreference = originalMessage.guild && serverSettings[originalMessage.guild.id]?.serverResponsePreference ? serverSettings[originalMessage.guild.id].responseStyle : getUserPreference(userId);
  const maxCharacterLimit = userPreference === 'embedded' ? 3900 : 1900;
  let attempts = 3;

  let updateTimeout;
  let tempResponse = '';

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('stopGenerating')
        .setLabel('Stop Generating')
        .setStyle(ButtonStyle.Danger)
    );

  await botMessage.edit({components: [row] });

  let stopGeneration = false;

  const filter = (interaction) => interaction.customId === 'stopGenerating' && interaction.user.id === originalMessage.author.id;

  const collector = botMessage.createMessageComponentCollector({ filter, time: 300000 });
  
  try {
    collector.on('collect', async (interaction) => {
      if (interaction.user.id === originalMessage.author.id) {
        try {
          await interaction.reply({ content: 'Response generation stopped by the user.', ephemeral: true });
        } catch (error) {
          console.error('Error sending reply:', error);
        }
        stopGeneration = true;
      } else {
        try {
          await interaction.reply({ content: "It's not for you.", ephemeral: true });
        } catch (error) {
          console.error('Error sending unauthorized reply:', error);
        }
      }
    });
  } catch (error) {
    console.error('Error creating or handling collector:', error);
  }

  const updateMessage = async () => {
    if (stopGeneration) {
      return;
    }
    if (tempResponse.trim() === "") {
      await botMessage.edit({ content: '...' });
    }
    if (userPreference === 'embedded') {
      await updateEmbed(botMessage, tempResponse, originalMessage);
    } else {
      await botMessage.edit({ content: tempResponse });
    }
    clearTimeout(updateTimeout);
    updateTimeout = null;
  };

  while (attempts > 0 && !stopGeneration) {
    try {
      const messageResult = await responseFunc();
      let finalResponse = '';
      let isLargeResponse = false;

      for await (const chunk of messageResult.stream) {
        if (stopGeneration) break;

        const chunkText = await chunk.text();
        finalResponse += chunkText;
        tempResponse += chunkText;

        if (finalResponse.length > maxCharacterLimit) {
          if (!isLargeResponse) {
            isLargeResponse = true;
            await botMessage.edit({ content: '> `The response is too large and will be sent as a text file once it is ready.`' });
          }
        } else if (!updateTimeout) {
          updateTimeout = setTimeout(updateMessage, 500);
        }
      }

      if (updateTimeout) {
        await updateMessage();
      }

      if (isLargeResponse) {
        await sendAsTextFile(finalResponse, originalMessage);
        await addSettingsButton(botMessage);
      } else {
        const shouldAddDownloadButton = originalMessage.guild ? serverSettings[originalMessage.guild.id]?.settingsSaveButton : true;
        if (shouldAddDownloadButton) {
          await addDownloadButton(botMessage);
        } else {
          await botMessage.edit({components: [] });
        }
      }
      const isServerChatHistoryEnabled = originalMessage.guild ? serverSettings[originalMessage.guild.id]?.serverChatHistory : false;
      updateChatHistory(isServerChatHistoryEnabled ? originalMessage.guild.id : userId, originalMessage.content.replace(new RegExp(`<@!?${client.user.id}>`), '').trim(), finalResponse);
      break;
    } catch (error) {
      if (activeRequests.has(userId)) {
        activeRequests.delete(userId);
      }
      console.error(error.message);
      attempts--;

      if (attempts === 0 || stopGeneration) {
        if (!stopGeneration) {
          const errorMsg = await originalMessage.channel.send({ content: `<@${originalMessage.author.id}>, All Generation Attempts Failed :( \`\`\`${error.message}\`\`\`` });
          await addSettingsButton(errorMsg);
          await addSettingsButton(botMessage);
        }
        break;
      } else {
        const errorMsg = await originalMessage.channel.send({ content: `<@${originalMessage.author.id}>, Generation Attempts Failed, Retrying.. \`\`\`${error.message}\`\`\`` });
        setTimeout(() => errorMsg.delete().catch(console.error), 5000);
        await delay(500);
      }
    }
  }
  saveStateToFile();
  if (activeRequests.has(userId)) {
    activeRequests.delete(userId);
  }
}

async function updateEmbed(botMessage, finalResponse, message) {
  try {
    const isGuild = message.guild !== null;
    const embed = new EmbedBuilder()
      .setColor(0x505050)
      .setDescription(finalResponse)
      .setAuthor({ name: `To ${message.author.displayName}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();
    if (isGuild) {
      embed.setFooter({ text: message.guild.name, iconURL: message.guild.iconURL() || 'https://ai.google.dev/static/site-assets/images/share.png' });
    }

    await botMessage.edit({ content: ' ', embeds: [embed] });
  } catch(error) {
    console.error("An error occurred while updating the embed:", error.message);
  }
}

async function sendAsTextFile(text, message) {
  try {
    const filename = `response-${Date.now()}.txt`;
    await writeFile(filename, text);

    const botMessage = await message.channel.send({ content: `<@${message.author.id}>, Here is the response:`, files: [filename] });
    await addSettingsButton(botMessage);

    // Cleanup: Remove the file after sending it
    await unlink(filename);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

async function attachmentToPart(attachment) {
  try {
    const response = await fetch(attachment.url);
    const buffer = await response.buffer();
    return { inlineData: { data: buffer.toString('base64'), mimeType: attachment.contentType } };
  } catch (error) {
    console.log(error.message);
  }
}

function getHistory(id) {
  return chatHistories[id]?.map((line, index) => ({
    role: index % 2 === 0 ? 'user' : 'model',
    parts: [{ text: line }],
  })) || [];
}

function updateChatHistory(id, userMessage, modelResponse) {
  if (!chatHistories[id]) {
    chatHistories[id] = [];
  }
  chatHistories[id].push(userMessage);
  chatHistories[id].push(modelResponse);
}

// <==========>



// <=====[Gen Function Handling]=====>

async function retryOperation(fn, maxRetries, delayMs = 1000) {
  let error;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.log(`Attempt ${attempt} failed: ${err.message}`);
      error = err;
      if (attempt < maxRetries) {
        console.log(`Waiting ${delayMs}ms before next attempt...`);
        await delay(delayMs);
      } else {
        console.log(`All ${maxRetries} attempts failed.`);
      }
    }
  }

  throw new Error(`Operation failed after ${maxRetries} attempts: ${error.message}`);
}

const nsfwWordsArray = require('./nsfwWords.json');

function filterPrompt(text) {
  nsfwWordsArray.forEach(word => {
    const regexPattern = new RegExp(word.split('').join('\\W*'), 'gi');
    text = text.replace(regexPattern, '');
  });
  return text;
}

// <==========>

client.login(token);
