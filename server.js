const express = require('express');
const cors = require('cors');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

// นำ URL ที่ได้จาก Google Apps Script มาใส่ตรงนี้ครับ
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz6b_Dgql048HOO_CkRNuHZCb04LfAWrvkc9Yt_SnSKoL9ldeLdc5oFTy0u6kZTVx3otA/exec';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/public', express.static(__dirname));

app.post('/api/concessions', async (req, res) => {
    try {
        const data = req.body;
        
        // 1. ยิงข้อมูลไปให้ Google Apps Script เพื่อรันเลขและบันทึกลง Sheet
        const scriptResponse = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const scriptResult = await scriptResponse.json();

        if (!scriptResult.success) {
            return res.status(500).json({ success: false, error: `บันทึก Sheet ไม่สำเร็จ: ${scriptResult.error}` });
        }

        const docNumber = scriptResult.documentNumber;

        // 2. สร้าง PDF ตามพิกัดที่ปรับไว้เป๊ะๆ
        const templatePath = path.join(__dirname, 'F-MR-002_02 .pdf');
        const fontPath = path.join(__dirname, '2.3.2 THSarabunNew.ttf');

        if (!fs.existsSync(templatePath)) {
            return res.status(404).json({ success: false, error: 'ไม่พบไฟล์ PDF แม่แบบ' });
        }

        const existingPdfBytes = fs.readFileSync(templatePath);
        const fontBytes = fs.readFileSync(fontPath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        pdfDoc.registerFontkit(fontkit);
        const customFont = await pdfDoc.embedFont(fontBytes);
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];
        const textSize = 14;
        
        // แสตมป์ข้อมูลลง PDF (ใช้พิกัดล่าสุดที่ตรงเป๊ะ)
        firstPage.drawText(docNumber, { x: 470, y: 775, size: textSize, font: customFont });
        firstPage.drawText(data.productName || '', { x: 140, y: 742, size: textSize, font: customFont });
        firstPage.drawText(String(data.quantity || ''), { x: 460, y: 742, size: textSize, font: customFont });
        
        const lotText = data.lotNumber || '';
        if (lotText.length > 50) {
            firstPage.drawText(lotText.substring(0, 50), { x: 140, y: 730, size: 12, font: customFont });
            firstPage.drawText(lotText.substring(50, 100), { x: 140, y: 715, size: 12, font: customFont });
        } else {
            firstPage.drawText(lotText, { x: 140, y: 723, size: textSize, font: customFont });
        }

        firstPage.drawText(data.department || '', { x: 460, y: 723, size: textSize, font: customFont });
        firstPage.drawText(data.rejectionReason || '', { x: 70, y: 690, size: textSize, font: customFont });
        firstPage.drawText(data.purpose || '', { x: 70, y: 640, size: textSize, font: customFont });
        
        if (data.issues) {
            const issueLines = data.issues.split('\n');
            let startY = 540;
            issueLines.forEach((line, index) => {
                if (index < 8 && line.trim() !== '') {
                    firstPage.drawText(line.trim(), { x: 70, y: startY, size: textSize, font: customFont });
                    startY -= 18;
                }
            });
        }
        
        firstPage.drawText(data.requesterName || '', { x: 100, y: 200, size: textSize, font: customFont });
        if (data.requesterSignature) {
            const base64Data = data.requesterSignature.replace(/^data:image\/png;base64,/, "");
            const signatureImageBytes = Buffer.from(base64Data, 'base64');
            const signatureImage = await pdfDoc.embedPng(signatureImageBytes);
            firstPage.drawImage(signatureImage, { x: 90, y: 220, width: 100, height: 40 });
        }

        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join(__dirname, `${docNumber}.pdf`);
        fs.writeFileSync(outputPath, pdfBytes);

        const pdfLink = `${req.protocol}://${req.get('host')}/public/${docNumber}.pdf`;
        res.json({ success: true, documentNumber: docNumber, pdfUrl: pdfLink });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
