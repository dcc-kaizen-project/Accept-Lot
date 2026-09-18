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
            return res.status(404).json({ success: false, error: `หาไฟล์แม่แบบ PDF ไม่เจอ` });
        }

        const existingPdfBytes = fs.readFileSync(templatePath);
        const fontBytes = fs.readFileSync(fontPath);

        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        pdfDoc.registerFontkit(fontkit);
        const customFont = await pdfDoc.embedFont(fontBytes);
        
        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        const textSize = 14;
        
        // 1. ขยับเลขที่เอกสารลงมาให้ตรงช่อง No. มากขึ้น
        firstPage.drawText(docNumber, { x: 480, y: 775, size: textSize, font: customFont });
        
        // 2. ชื่อผลิตภัณฑ์ & จำนวน
        // ----------------- ปรับตำแหน่งพิกัด (X, Y) -----------------
        const textSize = 14;
        
        // 1. เลขที่เอกสาร
        firstPage.drawText(docNumber, { x: 480, y: 765, size: textSize, font: customFont });
        
        // 2. ชื่อผลิตภัณฑ์ & จำนวน (ลด x ลงเหลือ 140 ให้ขยับมาทางซ้ายใกล้เส้น)
        firstPage.drawText(data.productName || '', { x: 140, y: 742, size: textSize, font: customFont });
        firstPage.drawText(String(data.quantity || ''), { x: 460, y: 742, size: textSize, font: customFont });
        
        // 3. Lot ผลิต & ชื่อหน่วยงาน (ลด x ลงเหลือ 140 ให้ตรงกับชื่อผลิตภัณฑ์)
        firstPage.drawText(data.lotNumber || '', { x: 140, y: 723, size: textSize, font: customFont });
        firstPage.drawText(data.department || '', { x: 460, y: 723, size: textSize, font: customFont });
        
        // 4. เหตุผลในการปฏิเสธลอต (เพิ่ม x เป็น 100 ให้ขยับเข้าขวา ไม่หลุดเส้นบรรทัด)
        firstPage.drawText(data.rejectionReason || '', { x: 100, y: 690, size: textSize, font: customFont });
        
        // 5. วัตถุประสงค์ (เพิ่ม x เป็น 100 ให้ขยับเข้าขวา ไม่หลุดเส้นบรรทัด)
        firstPage.drawText(data.purpose || '', { x: 100, y: 640, size: textSize, font: customFont });
        
        // 6. หัวข้อปัญหา (เพิ่ม x เป็น 120 ให้ขยับขวา พ้นระยะของตัวเลข 1) 2) 3) )
        if (data.issues) {
            const issueLines = data.issues.split('\n');
            let startY = 540;
            issueLines.forEach((line, index) => {
                if (index < 8 && line.trim() !== '') {
                    firstPage.drawText(line.trim(), { x: 120, y: startY, size: textSize, font: customFont });
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
        // ------------------------------------------------------------
        }
        
        // 7. ชื่อผู้ร้องขอ และ ลายเซ็น
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
