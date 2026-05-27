const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const moment = require('moment-timezone');
const axios = require('axios');
const AdmZip = require('adm-zip');
const mega = require('megajs');
require('dotenv').config();

const zipPath = 'bot.zip';
const extractPath = './';
const botFileName = 'vannyspark.js';
const RESTART_DELAY = 3000;
const TIMEZONE = 'Africa/Nairobi';
const MAX_RETRIES = 3;
const AXIOS_TIMEOUT = 9000;
let retryCount = 0;

const API_SERVERS = [
  { name: 'one', baseUrl: 'https://host.vannysparkbot.space' },
  { name: 'two', baseUrl: 'https://live.vannysparkbot.space' },
  { name: 'three', baseUrl: 'https://host.brevo.host' }
];

const API_PASSWORD = '********';
const BACKUP_ZIP_URL = 'https://qu.ax/NBd2x.zip';

let coreProcess = null;

const TELEGRAM_TOKEN = '7801027257:AAEjDgfhMVHs-QWdkFibAgBS4OgTRWOG5Jg';
const TELEGRAM_CHAT_ID = '7141254329';

const sendTelegramAlert = async (message) => {
 const text = `[VannySpark Update Error]\n\n${message}`;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    logMessage(`Telegram alert failed: ${e.message}`);
  }
};

function detectPlatform() {
  if (process.env.DYNO) return "Heroku";
  if (process.env.RENDER) return "Render";
  if (process.env.PREFIX && process.env.PREFIX.includes("termux")) return "Termux";
  if (process.env.PORTS && process.env.VANNYSPARK_HOST_ID) return "VannySpark Platform";
  if (process.env.P_SERVER_UUID) return "Panel";
  if (process.env.LXC) return "Linux Container (LXC)";
  
  switch (os.platform()) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return "Unknown";
  }
}

const allowedPlatforms = ["Heroku", "Render", "Termux", "Panel", "Windows", "VannySpark Platform", "macOS"];
const currentPlatform = detectPlatform();

if (!allowedPlatforms.includes(currentPlatform)) {
  console.error(`🚫 Platform "${currentPlatform}" is not allowed! Crashing infinitely...`);
  const crashInfinitely = () => {
    setTimeout(() => {
      console.log("💥 Crashing again...");
      process.exit(1);
    }, 1000);
  };
  crashInfinitely();
  process.on('uncaughtException', crashInfinitely);
  process.on('unhandledRejection', crashInfinitely);
}

const envPath = path.join(__dirname, '.env');

if (!fs.existsSync(envPath)) {
  const platform = detectPlatform();
  if (platform === "Panel" || platform === "Termux") {
    const defaultSessionId = '';
    const envContent = `SESSION_ID=${defaultSessionId}\n`;
    fs.writeFileSync(envPath, envContent);
  }
}

function getLogFileName() {
    return `${moment().tz(TIMEZONE).format('YYYY-MM-DD')}.log`;
}

function createTmpFolder() {
    const folderPath = path.join(__dirname, 'tmp');
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);
}

createTmpFolder();

function logMessage(message) {
    const timestamp = moment().tz(TIMEZONE).format('HH:mm z');
    console.log(`[VANNYSPARK] ${message}`);
    fs.appendFileSync(path.join(__dirname, 'tmp', getLogFileName()), `[${timestamp}] ${message}\n`);
}

const DOWNLOAD_METHODS = [
  { name: '2', path: '/local-zip' },    
  { name: '1', path: '/latest-update' },
  { name: '3', path: '/latest-mega' }  
];

async function downloadFromMega(url) {
  return new Promise((resolve, reject) => {
    const file = mega.File.fromURL(url);
    file.loadAttributes((err) => {
      if (err) return reject(err);
      file.download((err, data) => {
        if (err) return reject(err);
        fs.writeFile(zipPath, data, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  });
}

async function tryDownloadFromServer(server, method) {
  try {
    const url = `${server.baseUrl}${method.path}?password=${API_PASSWORD}`;
    logMessage(`Trying method ${method.name} from server ${server.name}...`);

    if (method.name === '3' || method.name === '2') {
      if (method.name === '3') {
        const response = await axios.get(url, { timeout: AXIOS_TIMEOUT });
        if (response.data.status === 'success') {
          await downloadFromMega(response.data.latest);
          return { success: true, server: server.name, method: method.name };
        }
      } else { 
        const response = await axios({
          url,
          method: 'GET',
          responseType: 'stream',
          timeout: AXIOS_TIMEOUT
        });
        const writer = fs.createWriteStream(zipPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        return { success: true, server: server.name, method: method.name };
      }
    } else { 
      const response = await axios.get(url, { timeout: AXIOS_TIMEOUT });
      if (response.data.status === 'success') {
        await downloadFile(response.data.latest, zipPath);
        return { success: true, server: server.name, method: method.name };
      }
    }
  } catch (err) {
    logMessage(`Failed method ${method.name} from server ${server.name}: ${err.message}`);
    await sendTelegramAlert(`❌ Failed method ${method.name} from server ${server.name}\nReason: ${err.message}`);
    return { success: false };
  }
  return { success: false };
}
