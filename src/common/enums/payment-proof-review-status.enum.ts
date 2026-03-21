export enum PaymentProofReviewStatus {
  NOT_REQUIRED = 'not_required',
  PENDING = 'pending',
  OCR_REVIEW = 'ocr_review',
  AUTO_APPROVED = 'auto_approved',
  MANUAL_APPROVED = 'manual_approved',
  MANUAL_REJECTED = 'manual_rejected',
}