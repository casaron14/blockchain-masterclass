import multer from 'multer';

import {
  MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES,
  MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_LABEL,
} from '../services/offlinePaymentReceiptService.js';

const offlinePaymentReceiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_BYTES,
    files: 1,
    fields: 4,
  },
});

export function receiveSingleOfflinePaymentReceiptFile(req, res, next) {
  offlinePaymentReceiptUpload.single('receipt')(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: `The receipt file must be ${MAX_OFFLINE_PAYMENT_RECEIPT_FILE_SIZE_LABEL} or smaller`,
          error: 'OFFLINE_PAYMENT_RECEIPT_FILE_TOO_LARGE',
        });
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          message: 'Upload the receipt in the "receipt" file field',
          error: 'OFFLINE_PAYMENT_RECEIPT_UNEXPECTED_FILE_FIELD',
        });
      }
      return res.status(400).json({
        message: 'The receipt upload could not be read',
        error: 'OFFLINE_PAYMENT_RECEIPT_UPLOAD_FAILED',
      });
    }

    return next(error);
  });
}
