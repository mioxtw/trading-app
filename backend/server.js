// backend/server.js
const express = require('express');
const http = require('http'); // 需要 http 模組來整合 express 和 ws
const cors = require('cors');
const path = require('path'); // <--- 引入 path 模組
const config = require('./config');
const apiRoutes = require('./routes/api');
const websocketService = require('./services/websocketService');

const app = express();
const server = http.createServer(app); // 創建 HTTP 伺服器實例

// --- 中間件 ---
app.use(cors()); // 允許所有來源的跨域請求 (開發時方便，生產環境應更嚴格)
app.use(express.json()); // 解析 JSON 請求體
app.use(express.urlencoded({ extended: true })); // 解析 URL 編碼的請求體

// --- 提供前端靜態檔案 ---
// 使用 path.join 確保路徑在不同作業系統下都正確
// __dirname 是目前 server.js 檔案所在的目錄 (backend)
// '../frontend' 是相對於 backend 目錄的前端資料夾
const frontendPath = path.join(__dirname, '../frontend');
console.log(`正在從以下路徑提供前端靜態檔案: ${frontendPath}`); // 除錯日誌
app.use(express.static(frontendPath));
// ------------------------

// --- API 路由 ---
app.use('/api', apiRoutes); // 將 /api/* 的請求交給 api.js 處理

// --- 讓前端 HTML 作為根路徑的回應 (可選，但常用) ---
// 如果請求不是 API 也不是靜態檔案，則發送 index.html
// 這對於單頁應用 (SPA) 尤其重要，但對於簡單 HTML 也適用
app.get('*', (req, res, next) => {
    // 檢查請求是否是 API 請求，如果是，則跳過
    if (req.originalUrl.startsWith('/api')) {
        return next();
    }
    // 否則，發送前端的入口 HTML 檔案
    const indexPath = path.join(frontendPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            // 如果發送 index.html 出錯 (例如檔案不存在)，則將錯誤傳遞給下一個錯誤處理器
             console.error(`發送 index.html 錯誤 (${indexPath}):`, err);
             // 可以選擇發送 404 錯誤
             if (!res.headersSent) { // 確保還沒發送任何回應
                 res.status(404).send('找不到資源');
             }
            // 或者調用 next(err) 讓 Express 的預設錯誤處理器處理
            // next(err);
        }
    });
});
// ------------------------------------

// --- 初始化並啟動後端 WebSocket 伺服器 ---
// 將 http server 實例傳遞給 websocketService
// **重要**: 確保 websocketService 使用正確的 server 實例
// 如果你的 websocketService.js 需要不同的 port，你需要創建一個獨立的 WS server
// 但通常依附於同一個 http server 是最常見的
websocketService.initBackendWss(server);

// --- 啟動後端服務 ---
server.listen(config.port, () => {
    console.log(`後端伺服器 (API + 前端靜態檔案) 正在監聽端口 ${config.port}`);

    // 伺服器啟動後，自動連接必要的 WebSocket 流
    if (config.binance.apiKey && config.binance.apiSecret) {
        console.log("偵測到 API 金鑰，正在嘗試連接用戶數據流...");
        websocketService.connectUserDataStream();
    } else {
        console.warn("未設定 API 金鑰，無法自動連接用戶數據流。");
    }
    console.log("正在連接預設市場數據流 (BTCUSDT)...");
    websocketService.connectMarketStream('BTCUSDT'); // 預設連接 BTC

    // *** 新增：連接標記價格流 ***
    console.log("正在連接標記價格流 (!markPrice@arr@1s)...");
    websocketService.connectMarkPriceStream();
    // **************************
});

// --- 錯誤處理 ---
process.on('uncaughtException', (error) => {
    console.error('未捕獲的異常:', error);
    // process.exit(1); // Consider graceful shutdown in production
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未處理的 Promise Rejection:', reason);
});