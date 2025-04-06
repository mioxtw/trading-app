// backend/config/index.js
require('dotenv').config();

const mode = process.env.API_MODE || 'testnet';

const config = {
    port: process.env.PORT || 3000, // 只需 HTTP 端口
    // websocketPort: process.env.WEBSOCKET_PORT || 3001, // 不再需要
    apiMode: mode,
    binance: {
        apiKey: mode === 'testnet' ? process.env.BINANCE_API_KEY_TESTNET : process.env.BINANCE_API_KEY_MAINNET,
        apiSecret: mode === 'testnet' ? process.env.BINANCE_API_SECRET_TESTNET : process.env.BINANCE_API_SECRET_MAINNET,
        restBaseUrl: mode === 'testnet' ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com',
        wsBaseUrl: mode === 'testnet' ? 'wss://stream.binancefuture.com' : 'wss://fstream.binance.com',
    }
};

if (!config.binance.apiKey || !config.binance.apiSecret) {
    console.warn(`警告：${mode.toUpperCase()} 模式的 API Key 或 Secret 未在 .env 檔案中設定！`);
} else {
    console.log(`後端 API 模式設定為: ${mode.toUpperCase()}`);
}
console.log(`後端設定 - HTTP & WebSocket Port: ${config.port}`); // 更新日誌

module.exports = config;