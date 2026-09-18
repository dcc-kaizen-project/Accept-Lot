const express = require('express');
const cors = require('cors');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/public', express.static(__dirname));

app.post('/api/concessions', async (req, res) => {
    try {
        const data = req.body;
        const year = new Date().getFullYear();
        const docNumber = `${data.plant}-${year}-999`;

        const templatePath = path.join(__dirname, 'F-MR-002_02 .pdf');
        const fontPath = path.join(__dirname, '2.3.2 THSarabunNew.ttf');

        if (!fs.existsSync(templatePath)) {
            const files = fs.readdirSync(__dirname);
            return res.status(404).json({ 
                success: false, 
                error: `หาไฟล์ 'F-MR-002_02 .pdf' ไม่เจอ!\nไฟล์ที่มีอยู่ในระบบตอนนี้คือ: ${files.join(', ')}` 
            });
        }

        const existingPdfBytes = fs.readFileSync(templatePath);
        const fontBytes = fs.readFileSync(fontPath);

        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        pdfDoc.registerFontkit(fontkit);
        const customFont = await pdfDoc.embedFont(fontBytes);
        
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        // ----------------- ตำแหน่งพิกัด (X, Y) -----------------
        const textSize = 14;
        
        // 1. เลขที่เอกสาร (ขยับแกน Y ลง และแกน X ไปซ้ายนิดหน่อย)
        firstPage.drawText(docNumber, { x: 470, y: 775, size: textSize, font: customFont });
        
        // 2. ชื่อผลิตภัณฑ์ & จำนวน
        firstPage.drawText(data.productName || '', { x: 140, y: 742, size: textSize, font: customFont });
        firstPage.drawText(String(data.quantity || ''), { x: 460, y: 742, size: textSize, font: customFont });
        
        // 3. Lot ผลิต & ชื่อหน่วยงาน
        firstPage.drawText(data.lotNumber || '', { x: 140, y: 723, size: textSize, font: customFont });
        firstPage.drawText(data.department || '', { x: 460, y: 723, size: textSize, font: customFont });
        
        // 4. เหตุผลในการปฏิเสธลอต (ลด x เหลือ 85 ขยับไปข้างหน้า/ทางซ้าย)
        firstPage.drawText(data.rejectionReason || '', { x: 70, y: 690, size: textSize, font: customFont });
        
        // 5. วัตถุประสงค์ (ลด x เหลือ 85 ขยับไปข้างหน้า/ทางซ้าย)
        firstPage.drawText(data.purpose || '', { x: 70, y: 640, size: textSize, font: customFont });
        
        // 6. หัวข้อปัญหา
        if (data.issues) {
            const issueLines = data.issues.split('\n');
            let startY = 540;
            issueLines.forEach((line, index) => {
                if (index < 8 && line.trim() !== '') {
                    firstPage.drawText(line.trim(), { x: 90, y: startY, size: textSize, font: customFont });
                    startY -= 18;
                }
            });
        }
        
        // 7. ชื่อผู้ร้องขอ และ ลายเซ็น
        firstPage.drawText(data.requesterName || '', { x: 100, y: 200, size: textSize, font: customFont });
        if (data.requesterSignature) {
            const base64Data = data.requesterSignature.replace(/^data:image\/png;base64,/, "");
            const signatureImageBytes = Buffer.from(base64Data, 'base64');
            const signatureImage = await pdfDoc.embedPng(signatureImageBytes);
            
            firstPage.drawImage(signatureImage, { x: 90, y: 220, width: 100, height: 40 });
        }
        // ----------------------------------------------------------------

        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join(__dirname, `${docNumber}.pdf`);
        fs.writeFileSync(outputPath, pdfBytes);

        const pdfLink = `${req.protocol}://${req.get('host')}/public/${docNumber}.pdf`;
        res.json({ success: true, documentNumber: docNumber, pdfUrl: pdfLink });

    } catch (error) {
        console.error(error);
        const files = fs.readdirSync(__dirname);
        res.status(500).json({ success: false, error: `${error.message}\nไฟล์ที่มี: ${files.join(', ')}` });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
