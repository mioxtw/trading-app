// backend/routes/api.js
const express = require('express');
const router = express.Router();
const binanceService = require('../services/binanceService');
const websocketService = require('../services/websocketService');
const config = require('../config'); // <--- 引入 config

// 處理異步函數的錯誤中間件
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
        console.error("路由處理錯誤:", err);
        const status = err.status || 500;
        const message = err.binanceError?.msg || err.message || '內部伺服器錯誤';
        res.status(status).json({ success: false, message: message, code: err.binanceError?.code });
    });
};

// --- API 端點 ---

// 新增：提供前端設定的端點
router.get('/config', (req, res) => {
    console.log("請求 /api/config"); // Debug Log
    res.json({
        success: true,
        data: {
            websocketPort: config.websocketPort, // 從 config 讀取
            apiMode: config.apiMode
            // 可以加入其他前端需要的設定
        }
    });
});

// 獲取 K 線數據
router.get('/kline', asyncHandler(async (req, res) => {
    const { symbol, interval, limit } = req.query;
    if (!symbol || !interval) {
        return res.status(400).json({ success: false, message: '缺少 symbol 或 interval 參數' });
    }
    // 後端可以返回原始幣安格式，讓前端處理映射
    const data = await binanceService.getKlineData(symbol, interval, limit);
    res.json({ success: true, data });
}));

// 獲取帳戶餘額
router.get('/balance', asyncHandler(async (req, res) => {
    const data = await binanceService.getAccountBalance();
    res.json({ success: true, data });
}));

// 獲取持倉風險
router.get('/position', asyncHandler(async (req, res) => {
    const { symbol } = req.query;
    const data = await binanceService.getPositionRisk(symbol);
    res.json({ success: true, data });
}));

// 設定槓桿
router.post('/leverage', asyncHandler(async (req, res) => {
    const { symbol, leverage } = req.body;
    if (!symbol || leverage === undefined) {
        return res.status(400).json({ success: false, message: '缺少 symbol 或 leverage 參數' });
    }
    const leverageNum = parseInt(leverage);
     if (isNaN(leverageNum) || leverageNum < 1) {
         return res.status(400).json({ success: false, message: '無效的 leverage 參數' });
     }
    const data = await binanceService.setLeverage(symbol, leverageNum);
    res.json({ success: true, data });
}));

// 下單
router.post('/order', asyncHandler(async (req, res) => {
    const orderParams = req.body;
    if (!orderParams.symbol || !orderParams.side || !orderParams.type || !orderParams.quantity) {
         return res.status(400).json({ success: false, message: '缺少必要的訂單參數' });
    }
    const data = await binanceService.placeOrder(orderParams);
    res.json({ success: true, data });
}));

// 觸發用戶數據流連接
router.post('/connect-user-stream', asyncHandler(async (req, res) => {
     console.log("收到連接用戶數據流請求...");
     await websocketService.connectUserDataStream();
     res.json({ success: true, message: "已嘗試連接用戶數據流" });
}));


module.exports = router;