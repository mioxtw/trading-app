// test-ws-client.js
const WebSocket = require('ws'); // 使用 Node.js 的 ws 庫作為客戶端

// *** 確保這裡的 URL 和端口與您的後端 WebSocket 伺服器完全一致 ***
const TARGET_URL = 'ws://127.0.0.1:3001';

console.log(`[測試客戶端] 正在嘗試連接到 ${TARGET_URL}...`);

const ws = new WebSocket(TARGET_URL);

ws.on('open', () => {
    console.log('[測試客戶端] 連接成功！');
    // 連接成功後可以嘗試發送訊息
    ws.send(JSON.stringify({ type: 'ping' }));
    // 短暫等待後關閉
    setTimeout(() => ws.close(), 1000);
});

ws.on('message', (data) => {
    // 您的後端目前可能不會主動發送訊息給新連接，所以這裡可能不會觸發
    console.log(`[測試客戶端] 收到伺服器訊息: ${data}`);
});

ws.on('error', (error) => {
    // *** 這是關鍵：如果這裡報錯，說明 Node.js 本身也連不上 ***
    console.error('[測試客戶端] 連接錯誤:', error.message);
});

ws.on('close', (code, reason) => {
    console.log(`[測試客戶端] 連接已關閉。代碼: ${code}, 原因: ${reason ? reason.toString() : 'N/A'}`);
});