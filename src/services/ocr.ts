import Tesseract from 'tesseract.js';
import pdfParse from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { getFileType } from '../utils/fileUpload';

const OCR_TIMEOUT = parseInt(process.env.OCR_TIMEOUT || '30000');
const OCR_RETRY_COUNT = parseInt(process.env.OCR_RETRY_COUNT || '2');

export interface OCRResult {
  text: string;
  confidence: number;
  pages: number;
}

export async function extractTextFromFile(filePath: string): Promise<OCRResult> {
  const fileType = getFileType(filePath);
  let text = '';
  let confidence = 0;
  let pages = 1;

  try {
    if (fileType === 'pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
      pages = pdfData.numpages;
      confidence = 95; // PDF text extraction is usually high confidence
    } else if (fileType === 'image') {
      const result = await Promise.race([
        Tesseract.recognize(filePath, 'eng', {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT)
        ),
      ]);

      text = result.data.text;
      confidence = result.data.confidence || 0;
      pages = 1;
    } else {
      // For DOC/DOCX, we'd need a library like mammoth or docx
      // For now, return empty text
      logger.warn(`OCR not supported for file type: ${fileType}`);
      text = '';
      confidence = 0;
    }

    return {
      text: text.trim(),
      confidence,
      pages,
    };
  } catch (error: any) {
    logger.error('OCR extraction failed', { filePath, error: error.message });
    throw new Error(`OCR failed: ${error.message}`);
  }
}

export async function extractTextWithRetry(
  filePath: string,
  retries: number = OCR_RETRY_COUNT
): Promise<OCRResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`OCR attempt ${attempt}/${retries} for ${filePath}`);
      const result = await extractTextFromFile(filePath);
      logger.info(`OCR successful`, { filePath, confidence: result.confidence });
      return result;
    } catch (error: any) {
      lastError = error;
      logger.warn(`OCR attempt ${attempt} failed`, { filePath, error: error.message });
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
      }
    }
  }

  throw lastError || new Error('OCR failed after retries');
}
