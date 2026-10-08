const mineflayer = require('mineflayer');
const readline = require('readline');

// ============================================================
// CONFIG
// ============================================================

const config = {
  host: 'conquestmc.top',
  port: 25565,
  username: 'Bowo1',
  version: '1.21.4',
  password: '123456dung'
};

// ============================================================
// SETTINGS
// ============================================================

// Mineflayer default = 30 seconds.
// 5 minutes gives more tolerance to temporary lag.
const checkTimeoutInterval = 300000;

// Reconnect after 5 seconds
const reconnectDelay = 5000;

// Wait before /login after spawn
const loginDelay = 1500;

// Wait between /login and /afk
const afkDelay = 2500;

// ============================================================
// STATE
// ============================================================

let currentBot = null;
let reconnectTimer = null;

let loginTimer = null;
let afkTimer = null;

let shuttingDown = false;

// Prevent repeated "tick_end enabled" messages
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
  // Direct sender name
  if (packet.senderName) {
    const name = cleanText(packet.senderName);

    if (name) {
      return name;
    }
  }

  // Try UUID -> player list
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
// SEND CLIENT TICK END
// ============================================================
//
// Minecraft 1.21.3+ has the serverbound "tick_end" packet.
//
// Grim's TickTimer uses this packet as the boundary between
// client ticks. Mineflayer does not yet send it in its normal
// released physics implementation, so we add it here.
//
// IMPORTANT:
// The packet is called "tick_end", NOT "client_tick_end".
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
      // If the installed protocol does not know this packet,
      // do not crash the entire bot.
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

  // Reset this so every fresh connection can report its state
  tickEndMessageShown = false;

  console.log(
    `[BOT] Đang kết nối ${config.host}:${config.port}...`
  );

  const bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,

    // Keep Minecraft keepalive enabled
    keepAlive: true,

    // 5-minute Mineflayer timeout instead of the default 30s
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

    // --------------------------------------------------------
    // LOGIN
    // --------------------------------------------------------

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

      console.log(
        '[BOT] Gửi /login...'
      );

      bot.chat(
        `/login ${config.password}`
      );

      loginTimer = null;

      // ------------------------------------------------------
      // AFK
      // ------------------------------------------------------

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

        console.log(
          '[BOT] Gửi /afk...'
        );

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
    console.log(
      '[KICKED]',
      reason
    );

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

  // Prevent duplicate reconnect timers
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

  // Example:
  // hi
  // /spawn
  // /msg player hello

  currentBot.chat(message);

  rl.prompt();
});

// ============================================================
// CTRL + C
// ============================================================

rl.on('SIGINT', () => {
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

  setTimeout(() => {
    process.exit(0);
  }, 500);
});

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