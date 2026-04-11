/** Determines how a document is processed during ingestion. */
export enum ProcessingMode {
	/** Extract text natively first; fall back to OCR only if text extraction fails. */
	TextFirst = 'text_first',
	/** Run OCR on the document first, ignoring any embedded text layer. */
	OcrFirst = 'ocr_first',
	/** Combine native text extraction and OCR, merging results for best accuracy. */
	Hybrid = 'hybrid',
}
