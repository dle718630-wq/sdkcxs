const mineflayer = require('mineflayer');
const readline = require('readline');
const http = require('http');

// ============================================================
// RENDER WEB SERVER
// ============================================================

const WEB_PORT = process.env.PORT || 3000;

const webServer = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain'
  });

  res.end('Bowo Minecraft bot is running!');
});

webServer.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`[WEB] Listening on port ${WEB_PORT}`);
});

// ============================================================
// CONFIG
// ============================================================

const config = {
  host: 'conquestmc.top',
  port: 25565,
  username: 'Bowo1',
  version: '1.21.4',

  // Put your password in Render Environment Variables
  password: process.env.123456dung
};

// ============================================================
// SETTINGS
// ============================================================

const checkTimeoutInterval = 300000;
const reconnectDelay = 5000;
const loginDelay = 1500;
const afkDelay = 2500;

// ============================================================
// STATE
// ============================================================

let currentBot = null;
let reconnectTimer = null;

let loginTimer = null;
let afkTimer = null;

let shuttingDown = false;
let tickEndMessageShown = false;

// ============================================================
// TEXT HELPERS
// ============================================================

function componentToText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);

      if (parsed !== value) {
        return componentToText(parsed);
      }
    } catch {}

    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(componentToText)
      .join('');
  }

  if (typeof value === 'object') {
    let result = '';

    if (value.text) {
      result += value.text;
    }

    if (value.translate) {
      result += value.translate;
    }

    if (Array.isArray(value.extra)) {
      result += value.extra
        .map(componentToText)
        .join('');
    }

    if (Array.isArray(value.with)) {
      result += value.with
        .map(componentToText)
        .join('');
    }

    return result;
  }

  return String(value);
}

function cleanText(value) {
  return componentToText(value)
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/\u0000/g, '')
    .trim();
}

// ============================================================
// PLAYER CHAT NAME
// ============================================================

function getSenderName(packet, bot) {
  if (packet.senderName) {
    const name = cleanText(packet.senderName);

    if (name) {
      return name;
    }
  }

  const uuid =
    packet.senderUuid ||
    packet.sender;

  if (uuid && bot && bot.players) {
    for (const player of Object.values(bot.players)) {
      if (!player) continue;

      if (
        player.uuid === uuid ||
        player.entity?.uuid === uuid
      ) {
        return player.username;
      }
    }
  }

  return 'Unknown';
}

// ============================================================
// PLAYER CHAT MESSAGE
// ============================================================

function getPlayerMessage(packet) {
  if (packet.plainMessage !== undefined) {
    const text = cleanText(packet.plainMessage);

    if (text) {
      return text;
    }
  }

  if (packet.unsignedChatContent !== undefined) {
    const text = cleanText(
      packet.unsignedChatContent
    );

    if (text) {
      return text;
    }
  }

  if (packet.message !== undefined) {
    return cleanText(packet.message);
  }

  return '';
}

// ============================================================
// CLEAR TIMERS
// ============================================================

function clearBotTimers() {
  if (loginTimer) {
    clearTimeout(loginTimer);
    loginTimer = null;
  }

  if (afkTimer) {
    clearTimeout(afkTimer);
    afkTimer = null;
  }
}

// ============================================================
// TICK END
// ============================================================

function setupTickEnd(bot) {
  bot.on('physicsTick', () => {
    if (shuttingDown) {
      return;
    }

    if (!bot._client) {
      return;
    }

    if (bot._client.state !== 'play') {
      return;
    }

    try {
      bot._client.write('tick_end', {});

      if (!tickEndMessageShown) {
        console.log(
          '[BOT] tick_end packets enabled.'
        );

        tickEndMessageShown = true;
      }

    } catch (err) {
      if (!tickEndMessageShown) {
        console.log(
          '[BOT] tick_end packet is not available in this protocol.'
        );

        tickEndMessageShown = true;
      }
    }
  });
}

// ============================================================
// CREATE BOT
// ============================================================

function createBot() {
  if (shuttingDown) {
    return;
  }

  clearBotTimers();

  tickEndMessageShown = false;

  if (!config.password) {
    console.error(
      '[CONFIG] MC_PASSWORD is missing.'
    );

    return;
  }

  console.log(
    `[BOT] Đang kết nối ${config.host}:${config.port}...`
  );

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,

    keepAlive: true,
    checkTimeoutInterval: checkTimeoutInterval
  });

  currentBot = bot;

  // ==========================================================
  // TICK END
  // ==========================================================

  setupTickEnd(bot);

  // ==========================================================
  // RAW PLAYER CHAT
  // ==========================================================

  bot._client.on('player_chat', (packet) => {
    try {
      const username =
        getSenderName(packet, bot);

      const message =
        getPlayerMessage(packet);

      if (!message) {
        return;
      }

      console.log(
        `[CHAT] <${username}> ${message}`
      );

    } catch (err) {
      console.error(
        '[PLAYER_CHAT ERROR]',
        err.message
      );
    }
  });

  // ==========================================================
  // RAW SYSTEM CHAT
  // ==========================================================

  bot._client.on('system_chat', (packet) => {
    try {
      const message = cleanText(
        packet.content ||
        packet.message ||
        packet.text ||
        ''
      );

      if (!message) {
        return;
      }

      console.log(
        `[SERVER] ${message}`
      );

    } catch (err) {
      console.error(
        '[SYSTEM_CHAT ERROR]',
        err.message
      );
    }
  });

  // ==========================================================
  // SPAWN
  // ==========================================================

  bot.once('spawn', () => {
    console.log('[BOT] Đã vào server.');

    loginTimer = setTimeout(() => {
      if (shuttingDown) {
        return;
      }

      if (!bot.player) {
        console.log(
          '[BOT] Chưa sẵn sàng để /login.'
        );

        return;
      }

      console.log('[BOT] Gửi /login...');

      bot.chat(`/login ${config.password}`);

      loginTimer = null;

      afkTimer = setTimeout(() => {
        if (shuttingDown) {
          return;
        }

        if (!bot.player) {
          console.log(
            '[BOT] Mất kết nối trước khi gửi /afk.'
          );

          return;
        }

        console.log('[BOT] Gửi /afk...');

        bot.chat('/afk');

        afkTimer = null;

      }, afkDelay);

    }, loginDelay);
  });

  // ==========================================================
  // WHISPER
  // ==========================================================

  bot.on('whisper', (username, message) => {
    console.log(
      `[WHISPER] <${username}> ${message}`
    );
  });

  // ==========================================================
  // KICK
  // ==========================================================

  bot.on('kicked', (reason) => {
    console.log('[KICKED]', reason);

    const readable = cleanText(reason);

    if (readable) {
      console.log(
        `[KICK REASON] ${readable}`
      );
    }
  });

  // ==========================================================
  // ERROR
  // ==========================================================

  bot.on('error', (err) => {
    console.error(
      '[ERROR]',
      err.message || err
    );
  });

  // ==========================================================
  // DISCONNECT
  // ==========================================================

  bot.on('end', (reason) => {
    clearBotTimers();

    console.log(
      `[BOT] Mất kết nối: ${reason || 'unknown'}`
    );

    if (currentBot === bot) {
      currentBot = null;
    }

    if (!shuttingDown) {
      scheduleReconnect();
    }
  });
}

// ============================================================
// RECONNECT
// ============================================================

function scheduleReconnect() {
  if (shuttingDown) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  console.log(
    `[BOT] Sẽ reconnect sau ${reconnectDelay / 1000}s...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (!shuttingDown) {
      createBot();
    }
  }, reconnectDelay);
}

// ============================================================
// TERMINAL CHAT / COMMAND
// ============================================================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

rl.prompt();

rl.on('line', (input) => {
  const message = input.trim();

  if (!message) {
    rl.prompt();
    return;
  }

  if (!currentBot || !currentBot.player) {
    console.log(
      '[BOT] Chưa vào server.'
    );

    rl.prompt();
    return;
  }

  currentBot.chat(message);

  rl.prompt();
});

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    '\n[BOT] Đang thoát...'
  );

  clearBotTimers();

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (currentBot) {
    try {
      currentBot.quit();
    } catch {}
  }

  try {
    webServer.close();
  } catch {}

  setTimeout(() => {
    process.exit(0);
  }, 500);
}

// Local PC
rl.on('SIGINT', shutdown);

// Render / Linux
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================================
// GLOBAL ERROR HANDLING
// ============================================================

process.on('uncaughtException', (err) => {
  console.error(
    '[UNCAUGHT EXCEPTION]',
    err
  );
});

process.on('unhandledRejection', (err) => {
  console.error(
    '[UNHANDLED REJECTION]',
    err
  );
});

// ============================================================
// START
// ============================================================

createBot();
