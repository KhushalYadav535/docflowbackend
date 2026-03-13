import express from 'express';
import { query, transaction } from '../database/connection';
import { AuthRequest, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog, AuditActions } from '../services/audit';
import { sendEmailNotification, emailTemplates } from '../services/emailService';

const router = express.Router();

// Submit document for approval
router.post('/documents/:id/approval/submit', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `UPDATE documents SET status = 'under_review', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.DOCUMENT_SUBMITTED_FOR_REVIEW,
      documentId: req.params.id,
    });

    res.json({ success: true, message: 'Document submitted for approval' });
  } catch (error: any) {
    next(error);
  }
});

// Approve document (Manager/Admin only)
router.post('/documents/:id/approval/approve', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `UPDATE documents SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.DOCUMENT_APPROVED,
      documentId: req.params.id,
    });

    // Send email notification to document uploader
    const docResult = await query(
      `SELECT d.name, u.email, u.name as user_name
       FROM documents d
       INNER JOIN users u ON d.created_by = u.id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    
    if (docResult.rows.length > 0) {
      const doc = docResult.rows[0];
      const documentUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/documents/${req.params.id}`;
      const emailTemplate = emailTemplates.documentApproved(doc.user_name, doc.name, documentUrl);
      await sendEmailNotification(doc.email, emailTemplate.subject, emailTemplate.html);
    }

    res.json({ success: true, message: 'Document approved' });
  } catch (error: any) {
    next(error);
  }
});

// Reject document (Manager/Admin only)
router.post('/documents/:id/approval/reject', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const { comment } = req.body;

    if (!comment || !comment.trim()) {
      throw new AppError('Rejection comment is required', 400);
    }

    const result = await query(
      `UPDATE documents SET status = 'draft', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.DOCUMENT_REJECTED,
      documentId: req.params.id,
      metadataSnapshot: { comment },
    });

    // Send email notification to document uploader
    const docResult = await query(
      `SELECT d.name, u.email, u.name as user_name
       FROM documents d
       INNER JOIN users u ON d.created_by = u.id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );
    
    if (docResult.rows.length > 0) {
      const doc = docResult.rows[0];
      const documentUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/documents/${req.params.id}`;
      const emailTemplate = emailTemplates.documentRejected(doc.user_name, doc.name, comment, documentUrl);
      await sendEmailNotification(doc.email, emailTemplate.subject, emailTemplate.html);
    }

    res.json({ success: true, message: 'Document rejected' });
  } catch (error: any) {
    next(error);
  }
});

// Get pending approvals
router.get('/documents/pending-approvals', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT d.*, u.name as uploader_name, f.name as folder_name
       FROM documents d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN folders f ON d.folder_id = f.id
       WHERE d.tenant_id = $1 AND d.status = 'under_review'
       ORDER BY d.created_at ASC`,
      [req.tenantId]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

export default router;
