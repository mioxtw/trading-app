// backend/routes/api.js
const express = require('express');
const router = express.Router();
const binanceService = require('../services/binanceService');
const { broadcast } = require('../services/websocketService'); // <--- 導入 broadcast
const websocketService = require('../services/websocketService'); // 保留原始導入以供其他地方使用 (例如 connect-user-stream)
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

// 新增：獲取歷史成交紀錄
router.get('/trades/history', asyncHandler(async (req, res) => {
    const { symbol, limit } = req.query; // 可以選擇性地添加 limit
    if (!symbol) {
        return res.status(400).json({ success: false, message: '缺少 symbol 參數' });
    }
    // 假設 binanceService 中會有 getTradeHistory 函數
    const data = await binanceService.getTradeHistory(symbol, limit || 500); // 預設 limit 為 500
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

// 新增：處理止盈止損訂單 (創建/取消)
router.post('/conditional-order', asyncHandler(async (req, res) => {
    const params = req.body;
    console.log("收到條件訂單請求:", params); // Debug Log

    // 基本驗證 (更詳細的驗證應在 service 層)
    if (!params.symbol || !params.action || !params.type) {
        return res.status(400).json({ success: false, message: '缺少必要的條件訂單參數 (symbol, action, type)' });
    }
    if (params.action === 'create' && (!params.price || !params.side || !params.orderType)) {
         return res.status(400).json({ success: false, message: '創建訂單時缺少參數 (price, side, orderType)' });
    }
     if (params.action === 'cancel' && !params.type) { // 取消時至少需要 type
         // 後端可能還需要 orderId 或其他標識符，取決於實現
         console.warn("取消訂單請求，後端需要實現查找邏輯");
     }


    // 調用 binanceService 處理訂單
    const data = await binanceService.placeOrCancelConditionalOrder(params);
    // 將成功創建/取消的訂單信息廣播給所有客戶端
    if (data) { // 確保 service 返回了數據
        broadcast({
            type: 'conditionalOrderUpdate', // 定義一個新的消息類型
            action: params.action, // 'create' or 'cancel'
            orderType: params.type, // 'sl' or 'tp' (來自前端請求)
            symbol: params.symbol,
            // 包含從幣安返回的實際訂單數據 (例如訂單 ID, 狀態等)
            // 注意：幣安創建條件單的響應可能只包含基本確認，
            // 完整的訂單狀態可能需要通過用戶數據流更新。
            // 但至少我們可以通知前端操作已發送。
            binanceResponse: data
        });
    }
    res.json({ success: true, data }); // 仍然將結果返回給發起請求的客戶端
}));


module.exports = router;