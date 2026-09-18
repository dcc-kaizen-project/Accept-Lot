const express = require('express');
const cors = require('cors');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🌟 อนุญาตให้ระบบแสดงไฟล์ PDF ที่สร้างเสร็จแล้วผ่านลิงก์ /public
app.use('/public', express.static(__dirname));

app.post('/api/concessions', async (req, res) => {
    try {
        const data = req.body;
        
        // 1. สร้างเลขที่เอกสาร
        const year = new Date().getFullYear();
        const docNumber = `${data.plant}-${year}-999`; // (999 คือเลขสมมติชั่วคราว)

        // 2. โหลด PDF Template และฟอนต์ภาษาไทย
const templatePath = path.join(__dirname, 'F-MR-002_02.pdf');
const fontPath = path.join(__dirname, '2.3.2 THSarabunNew.ttf');
        
        const existingPdfBytes = fs.readFileSync(templatePath);
        const fontBytes = fs.readFileSync(fontPath);

        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        pdfDoc.registerFontkit(fontkit);
        const customFont = await pdfDoc.embedFont(fontBytes);
        
        const pages = pdfDoc.getPages();
        const firstPage = pages[0]; // เลือกหน้าแรก

        // 3. เขียนข้อความลง PDF (แกน Y เริ่มนับจากล่างขึ้นบน)
        const textSize = 14;
        firstPage.drawText(docNumber, { x: 450, y: 750, size: textSize, font: customFont });
        firstPage.drawText(data.productName || '', { x: 150, y: 700, size: textSize, font: customFont });
        firstPage.drawText(data.lotNumber || '', { x: 150, y: 680, size: textSize, font: customFont });
        firstPage.drawText(String(data.quantity || ''), { x: 450, y: 700, size: textSize, font: customFont });
        firstPage.drawText(data.purpose || '', { x: 120, y: 650, size: textSize, font: customFont });
        firstPage.drawText(data.requesterName || '', { x: 150, y: 250, size: textSize, font: customFont });

        // 4. แปะรูปลายเซ็น (ถ้ามีการเซ็นมา)
        if (data.requesterSignature) {
            const base64Data = data.requesterSignature.replace(/^data:image\/png;base64,/, "");
            const signatureImageBytes = Buffer.from(base64Data, 'base64');
            const signatureImage = await pdfDoc.embedPng(signatureImageBytes);
            
            // ปรับพิกัด x, y และขนาด width, height ให้ตรงกับช่องลายเซ็นผู้ร้องขอ
            firstPage.drawImage(signatureImage, {
                x: 120,
                y: 270, 
                width: 100,
                height: 40,
            });
        }

        // 5. บันทึกและสร้างเป็นไฟล์ PDF ใหม่
        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join(__dirname, `${docNumber}.pdf`);
        fs.writeFileSync(outputPath, pdfBytes);

        // 6. 🌟 สร้างลิงก์ดาวน์โหลดและส่งผลลัพธ์กลับไปให้หน้าเว็บ
        const pdfLink = `${req.protocol}://${req.get('host')}/public/${docNumber}.pdf`;
        res.json({ success: true, documentNumber: docNumber, pdfUrl: pdfLink });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
