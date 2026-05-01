const TelegramBot = require('node-telegram-bot-api');
const { IgApiClient, IgLoginTwoFactorRequiredError, IgCheckpointError } = require('instagram-private-api');
const { authenticator } = require('otplib');

const bot = new TelegramBot('7142079092:AAGHKZJ1K6BRQ7CckbNWeYyXmW05xGZ4FT8', { polling: true });
const sessions = {};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🤖 বট চালু হয়েছে।\n\nইউজারনেম দিন:");
    sessions[msg.chat.id] = { step: 'username' };
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!sessions[chatId] || text.startsWith('/')) return;

    let state = sessions[chatId];

    if (state.step === 'username') {
        state.username = text;
        state.step = 'password';
        bot.sendMessage(chatId, "🔑 পাসওয়ার্ড দিন:");
    } 
    else if (state.step === 'password') {
        state.password = text;
        state.step = '2fa';
        bot.sendMessage(chatId, "🔐 2FA Key দিন (না থাকলে skip লিখুন):");
    } 
    else if (state.step === '2fa') {
        state.2faKey = text;
        bot.sendMessage(chatId, "⏳ লগইন করার চেষ্টা করছি...");
        
        const ig = new IgApiClient();
        ig.state.generateDevice(state.username);
        state.ig = ig;
        
        try {
            await ig.simulate.preLoginFlow();
            await loginAction(chatId);
        } catch (e) {
            handleError(chatId, e);
        }
    }
    else if (state.step === 'checkpoint') {
        try {
            await state.ig.challenge.sendChallengeCode(text);
            await finishLogin(chatId);
        } catch (e) {
            bot.sendMessage(chatId, "❌ ভুল কোড! আবার দিন:");
        }
    }
});

async function loginAction(chatId) {
    const state = sessions[chatId];
    try {
        let code = state.2faKey.toLowerCase() === 'skip' ? null : authenticator.generate(state.2faKey.replace(/\s/g, ''));
        await state.ig.account.login(state.username, state.password);
        await finishLogin(chatId);
    } catch (e) {
        handleError(chatId, e);
    }
}

async function handleError(chatId, error) {
    const state = sessions[chatId];
    if (error instanceof IgLoginTwoFactorRequiredError) {
        const code = authenticator.generate(state.2faKey.replace(/\s/g, ''));
        await state.ig.account.twoFactorLogin({
            username: state.username,
            verificationCode: code,
            twoFactorIdentifier: error.response.body.two_factor_info.two_factor_identifier,
            verificationMethod: '1'
        });
        await finishLogin(chatId);
    } 
    else if (error instanceof IgCheckpointError) {
        await state.ig.challenge.auto(true);
        state.step = 'checkpoint';
        bot.sendMessage(chatId, "⚠️ ইমেইল/ফোনে কোড গেছে, সেটি এখানে দিন:");
    } 
    else {
        bot.sendMessage(chatId, "❌ ভুল: " + error.message);
        delete sessions[chatId];
    }
}

async function finishLogin(chatId) {
    const state = sessions[chatId];
    const cookies = await state.ig.state.serializeCookieJar();
    let cookieStr = cookies.cookies.map(c => `${c.key}=${c.value}`).join('; ');
    
    bot.sendMessage(chatId, `✅ কুকি:\n\n\`${cookieStr}\``, { parse_mode: "Markdown" });
    delete sessions[chatId];
}

console.log("বট চলছে...");
