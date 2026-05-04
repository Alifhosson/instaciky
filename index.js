const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { authenticator } = require('otplib');
const http = require('http');

// ১. Render-এর জন্য পোর্ট বাইন্ডিং (এটি না থাকলে Render অ্যাপ বন্ধ করে দেয়)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Instagram Cookie Extractor is Running...\n');
}).listen(PORT, () => {
  console.log(`Web server is listening on port ${PORT}`);
});

// ২. কনফিগারেশন
const TOKEN = '7142079092:AAGHKZJ1K6BRQ7CckbNWeYyXmW05xGZ4FT8'; 
const WEBHOOK_URL = "https://ins.skysysx.com/api/api/v1/webhook/FlxhUHdINnPQxsBhqqpNw4L4nn_1ICQyCKKXoGBETCg/account-push";

const bot = new TelegramBot(TOKEN, { polling: true });
const userStates = {};

// পোলিং এরর হ্যান্ডলিং (বট ক্র্যাশ হওয়া আটকাবে)
bot.on('polling_error', (error) => {
    console.error("Telegram Polling Error:", error.message);
});

console.log("বট সফলভাবে চালু হয়েছে...");

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🤖 **Instagram Smart Extractor**\n\n👤 ইউজারনেম (Username) দিন:");
    userStates[chatId] = { step: 'username' };
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!userStates[chatId] || !text || text.startsWith('/')) return;

    let state = userStates[chatId];

    if (state.step === 'username') {
        state.username = text.trim();
        state.step = 'password';
        bot.sendMessage(chatId, "🔑 পাসওয়ার্ড (Password) দিন:");
    } 
    else if (state.step === 'password') {
        state.password = text.trim();
        state.step = '2fa';
        bot.sendMessage(chatId, "🔐 2FA Key (Seed) দিন:");
    } 
    else if (state.step === '2fa') {
        state.twoFactorKey = text.trim(); 
        bot.sendMessage(chatId, "⏳ লগইন করে প্যানেলে পাঠানো হচ্ছে, দয়া করে অপেক্ষা করুন...");
        processLogin(chatId);
    }
});

async function processLogin(chatId) {
    const state = userStates[chatId];
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    try {
        // ১. সেশন এবং CSRF সংগ্রহ
        const initRes = await client.get('https://www.instagram.com/accounts/login/');
        const cookies = await jar.getCookies('https://www.instagram.com/');
        const csrf = cookies.find(c => c.key === 'csrftoken')?.value;

        if (!csrf) {
            return bot.sendMessage(chatId, "❌ এরর: CSRF টোকেন পাওয়া যায়নি। আইপি ব্লক হতে পারে।");
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

        // ২. পাসওয়ার্ড এনক্রিপশন (Version 10)
        const timestamp = Math.floor(Date.now() / 1000);
        const enc_password = `#PWD_INSTAGRAM_BROWSER:10:${timestamp}:${state.password}`;

        const payload = new URLSearchParams({
            enc_password: enc_password,
            username: state.username,
            queryParams: '{}',
            optIntoOneTap: 'false'
        });

        // ৩. লগইন রিকোয়েস্ট
        let loginRes = await client.post('https://www.instagram.com/api/v1/web/accounts/login/ajax/', payload, { headers });

        // ৪. ২-ফ্যাক্টর হ্যান্ডলিং
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

        // ৫. সফল হলে ডাটা ফরম্যাট ও প্যানেলে পুশ
        if (loginRes.data.authenticated === true) {
            const finalCookies = await jar.getCookies('https://www.instagram.com/');
            const cookieStr = finalCookies.map(c => `${c.key}=${c.value}`).join('; ');

            // আপনার প্যানেল ফরম্যাট: user:pass|||cookie||
            const finalData = `${state.username}:${state.password}|||${cookieStr}||`;
            const b64Data = Buffer.from(finalData).toString('base64');

            const pushRes = await axios.post(WEBHOOK_URL, `accounts=${b64Data}`, {
                headers: { 'Content-Type': 'text/plain' }
            });

            bot.sendMessage(chatId, `🎉 **সফল!**\n\n👤 ইউজার: \`${state.username}\`\n\n📊 প্যানেল স্ট্যাটাস: ✅ পুশ সফল\n📝 রেসপন্স: \`${JSON.stringify(pushRes.data)}\``, { parse_mode: 'Markdown' });
        } else {
            const errMsg = loginRes.data.message || "পাসওয়ার্ড ভুল বা আইপি সমস্যা।";
            bot.sendMessage(chatId, `❌ ব্যর্থ: ${errMsg}`);
        }
    } catch (err) {
        bot.sendMessage(chatId, `❌ টেকনিক্যাল এরর: ${err.message}`);
    } finally {
        delete userStates[chatId];
    }
}
