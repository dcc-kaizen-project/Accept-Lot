const express = require('express');
const cors = require('cors');

// ⚠️ ใส่ Web App URL อันล่าสุดของคุณตรงนี้
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwKYSj9Gw25U9RQ-VNYtsAtZyRkOOUM0EHgd-OMBhJFwVkhv7wbIX7OYEGfTjjMfNg7-A/exec';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/api/concessions', async (req, res) => {
    try {
        const data = req.body;
        
        // 1. ส่งข้อมูลให้ Google Apps Script เพื่อบันทึกลง Sheet และแจ้ง LINE
        const scriptResponse = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const scriptResult = await scriptResponse.json();

        if (!scriptResult.success) {
            return res.status(500).json({ success: false, error: scriptResult.error });
        }

        // 2. ส่งแค่เลขที่เอกสารกลับไป (ยังไม่ต้องสร้าง PDF จนกว่า ผจก. จะเซ็น)
        res.json({ 
            success: true, 
            documentNumber: scriptResult.documentNumber,
            lineStatus: scriptResult.lineStatus
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
