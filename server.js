const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const line = require('@line/bot-sdk');
const multer = require('multer');
require('dotenv').config();

const app = express();
app.use(cors());

// ขยายขีดจำกัดการรับข้อมูลเป็น 10MB เพื่อรองรับรูปภาพลายเซ็น Base64
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// 1. เชื่อมต่อ PostgreSQL (Supabase Database)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2. ตั้งค่า Supabase Storage URL และ Key
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

// 3. เชื่อมต่อ LINE Messaging API
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const lineClient = new line.Client(lineConfig);

// Webhook สำหรับจับ Group ID จาก LINE
app.post('/api/webhook', (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    if (event.source && event.source.groupId) {
      console.log('>>> YOUR LINE_GROUP_ID IS:', event.source.groupId);
    }
  }
  res.status(200).send('OK');
});

// =========================================================================
// 📌 1. API เดิม: สำหรับ "แจ้งข้อร้องเรียนสินค้า (QA Complaint)"
// =========================================================================
app.post('/api/complaints', upload.array('files', 10), async (req, res) => {
  console.log('=== NEW COMPLAINT REQUEST RECEIVED ===');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const data = req.body;

    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7).replace('-', '');
    const todayStr = now.toISOString().slice(0, 10);

    const countRes = await client.query(
      `SELECT COUNT(*) FROM complaints WHERE ticket_number LIKE $1`,
      [`CMP-${yearMonth}-%`]
    );
    const nextSeq = String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0');
    const ticketNumber = `CMP-${yearMonth}-${nextSeq}`;

    const storeName = data.storeName || data.contactName || '-';
    const agencyName = data.agencyName || '-';
    const reporterName = data.reporterName || data.contactName || '-';
    const issueFoundDate = data.issueFoundDate || todayStr;
    const receivedDate = data.receivedDate || issueFoundDate || todayStr;

    const insertComplaintQuery = `
      INSERT INTO complaints (
        ticket_number, submitted_by_role, contact_name, contact_phone, contact_email,
        product_type, product_size, do_number, received_date, issue_found_date,
        issue_description, defect_quantity, incident_environment, discovered_by,
        site_visit_required, site_visit_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id;
    `;
    const values = [
      ticketNumber, 
      data.submittedByRole || 'CUSTOMER', 
      reporterName, 
      data.contactPhone || '-', 
      data.contactEmail || null,
      data.productType || '-', 
      data.productSize || '-', 
      data.doNumber || '-', 
      receivedDate, 
      issueFoundDate,
      data.issueDescription || '-', 
      data.defectQuantity ? parseInt(data.defectQuantity) : 0,
      data.incidentEnvironment || '-', 
      data.discoveredBy || '-',
      data.siteVisitRequired === 'true', 
      data.siteVisitDate || null
    ];
    const resComplaint = await client.query(insertComplaintQuery, values);
    const complaintId = resComplaint.rows[0].id;

    await client.query(
      `INSERT INTO complaint_sla_logs (complaint_id, phase_1_submitted_at) VALUES ($1, NOW())`,
      [complaintId]
    );

    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      let fileIndex = 1;
      for (const file of req.files) {
        const fileExt = file.originalname.split('.').pop().toLowerCase() || 'bin';
        const fileName = `${ticketNumber}_${fileIndex}.${fileExt}`;
        fileIndex++;
        
        const uploadEndpoint = `${supabaseUrl}/storage/v1/object/complaint-images/${fileName}`;
        
        const response = await fetch(uploadEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apiKey': supabaseKey,
            'Content-Type': file.mimetype,
            'x-upsert': 'true'
          },
          body: file.buffer
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error('❌ Direct Upload Failed:', response.status, errText);
        } else {
          const fileUrl = `${supabaseUrl}/storage/v1/object/public/complaint-images/${fileName}`;
          const isPdf = fileExt === 'pdf';
          uploadedFiles.push({ url: fileUrl, isPdf: isPdf, name: fileName });

          await client.query(
            `INSERT INTO complaint_attachments (complaint_id, file_type, file_url) VALUES ($1, $2, $3)`,
            [complaintId, 'PRODUCT_DEFECT', fileUrl]
          );
        }
      }
    }

    await client.query('COMMIT');

    if (process.env.LINE_GROUP_ID) {
      let attachmentText = '';
      if (uploadedFiles.length > 0) {
        attachmentText = `\n📎 ไฟล์แนบ (${uploadedFiles.length} ไฟล์):\n` + 
          uploadedFiles.map((item, i) => `${item.isPdf ? '📄 PDF' : '🖼️ รูป'}${i+1}: ${item.url}`).join('\n');
      } else {
        attachmentText = '\n📎 ไฟล์แนบ: ไม่มีไฟล์แนบ';
      }

      const lineMessage = {
        type: 'text',
        text: `🏪 ร้านค้า: ${storeName}\n🏢 หน่วยงาน: ${agencyName}\n👤 ผู้ลงข้อมูล: ${reporterName}\n----------------------------------\n🚨 ข้อร้องเรียนเลขที่: [${ticketNumber}]\n📅 วันที่พบปัญหา: ${issueFoundDate}\n📦 ชนิดสินค้า: ${data.productType || '-'}\n📐 ขนาด: ${data.productSize || '-'}\n📄 เลขที่ DO: ${data.doNumber || '-'}\n🔢 จำนวนที่มีปัญหา: ${data.defectQuantity || 0}\n📞 เบอร์ติดต่อ: ${data.contactPhone || '-'}\n📝 รายละเอียด: ${data.issueDescription || '-'}${attachmentText}\n\nกรุณาเข้าตรวจสอบข้อมูลในระบบ`
      };
      await lineClient.pushMessage(process.env.LINE_GROUP_ID, lineMessage);
    }

    if (process.env.GOOGLE_SHEET_WEBHOOK_URL) {
      try {
        const sheetPayload = {
          ticketNumber: ticketNumber,
          createdAt: todayStr,
          storeName: storeName,
          agencyName: agencyName,
          reporterName: reporterName,
          contactPhone: data.contactPhone || '-',
          issueFoundDate: issueFoundDate,
          productType: data.productType || '-',
          productSize: data.productSize || '-',
          doNumber: data.doNumber || '-',
          defectQuantity: data.defectQuantity || 0,
          issueDescription: data.issueDescription || '-',
          attachmentUrls: uploadedFiles.map(f => f.url).join(', ')
        };

        fetch(process.env.GOOGLE_SHEET_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sheetPayload)
        }).catch(e => console.error('Sheet fetch error:', e));
      } catch (sheetErr) {
        console.error('Google Sheet Error:', sheetErr);
      }
    }

    res.status(200).json({ success: true, ticketNumber: ticketNumber });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ General Processing Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// =========================================================================
// 📌 2. API สำหรับ "ขอยอมรับผลิตภัณฑ์แบบมีเงื่อนไข (Accept-Lot: FCB & CRT)"
// =========================================================================

app.post('/api/concessions', async (req, res) => {
  console.log('=== NEW CONCESSION REQUEST RECEIVED ===');
  const client = await pool.connect();
  try {
    const { plant, productName, productSize, lotNumber, quantity, purpose, requesterName, requesterSignature } = req.body;

    // ตรวจสอบสายการผลิต (FCB หรือ CRT)
    const plantPrefix = (plant && plant.toUpperCase() === 'CRT') ? 'CRT' : 'FCB';
    const currentYear = new Date().getFullYear().toString(); // ปี ค.ศ. ปัจจุบัน เช่น 2026

    // ค่าเริ่มต้นถ้ายังไม่มีข้อมูลในปีนั้นๆ (FCB เริ่มต่อจาก 108 -> เป็น 109 / CRT เริ่มต่อจาก 20 -> เป็น 21)
    const baseOffset = (plantPrefix === 'FCB') ? 108 : 20;

    // นับจำนวนเอกสารที่มีอยู่ในสายการผลิตนั้นๆ ของปีปัจจุบัน
    const countRes = await client.query(
      `SELECT COUNT(*) FROM concession_requests WHERE document_number LIKE $1`,
      [`${plantPrefix}-${currentYear}-%`]
    );
    
    // คำนวณลำดับถัดไป
    const currentCount = parseInt(countRes.rows[0].count);
    const nextSeqNum = baseOffset + currentCount + 1;
    const nextSeq = String(nextSeqNum).padStart(3, '0');
    
    // สร้างเลขเอกสาร เช่น FCB-2026-109 หรือ CRT-2026-021
    const docNum = `${plantPrefix}-${currentYear}-${nextSeq}`;

    // บันทึกลงตาราง concession_requests ใน Supabase
    const query = `
      INSERT INTO concession_requests 
      (document_number, product_name, product_size, lot_number, quantity, purpose, requester_name, requester_signature, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING_MANAGER')
      RETURNING id, document_number;
    `;
    const values = [
      docNum, 
      productName, 
      productSize || '-', 
      lotNumber, 
      parseInt(quantity) || 0, 
      purpose, 
      requesterName, 
      requesterSignature
    ];
    const result = await client.query(query, values);
    const newDoc = result.rows[0];

    // ส่ง LINE แจ้งเตือนเข้ากลุ่ม
    if (process.env.LINE_GROUP_ID) {
      const msg = {
        type: 'text',
        text: `📋 คำขอยอมรับผลิตภัณฑ์แบบมีเงื่อนไข [${docNum}]\n🏭 สายการผลิต: ${plantPrefix}\n----------------------------------\n📦 สินค้า: ${productName}\n📐 ขนาด: ${productSize || '-'}\n🔢 Lot: ${lotNumber}\n📊 จำนวน: ${quantity}\n📝 วัตถุประสงค์: ${purpose}\n✍️ ผู้ร้องขอ: ${requesterName}\n\n📌 สถานะ: รอหัวหน้างานทบทวนและลงนามอนุมัติ`
      };
      await lineClient.pushMessage(process.env.LINE_GROUP_ID, msg);
    }

    res.status(200).json({ success: true, documentNumber: newDoc.document_number, id: newDoc.id });
  } catch (err) {
    console.error('❌ Concession Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// API สำหรับดึงรายการคำขอยอมรับทั้งหมด
app.get('/api/concessions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM concession_requests ORDER BY id DESC');
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
