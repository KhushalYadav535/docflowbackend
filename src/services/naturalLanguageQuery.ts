// Natural Language Query Processing
// Converts natural language queries to structured search filters

interface ParsedQuery {
  keywords: string[];
  dateFrom?: string;
  dateTo?: string;
  documentType?: string;
  department?: string;
  uploadedBy?: string;
  folderId?: string;
}

export function parseNaturalLanguageQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    keywords: [],
  };

  if (!query) return result;

  const lowerQuery = query.toLowerCase();
  const words = query.split(/\s+/);

  // Extract date patterns
  const currentYear = new Date().getFullYear();
  const yearMatch = query.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    result.dateFrom = `${year}-01-01`;
    result.dateTo = `${year}-12-31`;
  }

  // Extract "from" patterns (e.g., "invoice from ABC", "document from John")
  const fromMatch = query.match(/\bfrom\s+([A-Za-z0-9\s]+?)(?:\s+(?:in|on|during|from|to|$)|$)/i);
  if (fromMatch) {
    const fromValue = fromMatch[1].trim();
    // Check if it looks like a person name (capitalized words)
    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(fromValue)) {
      result.uploadedBy = fromValue;
    } else {
      // Might be a department or company
      result.department = fromValue;
    }
  }

  // Extract "in" patterns (e.g., "documents in Finance", "files in Q1")
  const inMatch = query.match(/\bin\s+([A-Za-z0-9\s]+?)(?:\s+(?:from|to|during|$)|$)/i);
  if (inMatch && !result.department) {
    result.department = inMatch[1].trim();
  }

  // Extract document type patterns
  const typePatterns = [
    { pattern: /\b(invoice|invoices)\b/i, type: 'Invoice' },
    { pattern: /\b(contract|contracts|agreement|agreements)\b/i, type: 'Contract' },
    { pattern: /\b(report|reports)\b/i, type: 'Report' },
    { pattern: /\b(receipt|receipts)\b/i, type: 'Receipt' },
    { pattern: /\b(letter|letters)\b/i, type: 'Letter' },
    { pattern: /\b(memo|memos|memorandum)\b/i, type: 'Memo' },
    { pattern: /\b(form|forms)\b/i, type: 'Form' },
  ];

  for (const { pattern, type } of typePatterns) {
    if (pattern.test(query)) {
      result.documentType = type;
      break;
    }
  }

  // Extract keywords (remove extracted patterns)
  let keywordQuery = query;
  
  // Remove date patterns
  keywordQuery = keywordQuery.replace(/\b(20\d{2})\b/g, '');
  
  // Remove "from X" patterns
  if (fromMatch) {
    keywordQuery = keywordQuery.replace(/\bfrom\s+([A-Za-z0-9\s]+?)(?:\s+(?:in|on|during|from|to|$)|$)/i, '');
  }
  
  // Remove "in X" patterns
  if (inMatch) {
    keywordQuery = keywordQuery.replace(/\bin\s+([A-Za-z0-9\s]+?)(?:\s+(?:from|to|during|$)|$)/i, '');
  }
  
  // Remove document type words
  keywordQuery = keywordQuery.replace(/\b(invoice|invoices|contract|contracts|report|reports|receipt|receipts|letter|letters|memo|memos|memorandum|form|forms)\b/gi, '');

  // Clean up and extract remaining keywords
  result.keywords = keywordQuery
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from'].includes(word.toLowerCase()));

  return result;
}

export function convertToSearchFilters(parsed: ParsedQuery) {
  return {
    keyword: parsed.keywords.join(' '),
    dateFrom: parsed.dateFrom,
    dateTo: parsed.dateTo,
    documentType: parsed.documentType,
    department: parsed.department,
    uploadedBy: parsed.uploadedBy,
    folderId: parsed.folderId,
  };
}
