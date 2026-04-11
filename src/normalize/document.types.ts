/**
 * A document that has been OCR-processed and normalized into a uniform structure.
 * This is the canonical representation used by chunking, embedding, and retrieval.
 */
export interface NormalizedDocument {
	documentId: string;
	sourceName: string;
	mimeType: string;
	pageCount: number;
	pages: NormalizedPage[];
	tables: NormalizedTable[];
	links: NormalizedLink[];
	warnings: OcrWarning[];
	providerMetadata: OcrProviderMetadata;
	totalCharacters: number;
	language?: string;
	createdAt: string;
}

/** A single page extracted from a normalized document, with both markdown and plain text. */
export interface NormalizedPage {
	pageIndex: number;
	/** Page content rendered as markdown. */
	markdown: string;
	/** Page content as plain text (markdown stripped). */
	text: string;
	characterCount: number;
	hasImages: boolean;
	hasTablesOnPage: boolean;
	warnings: OcrWarning[];
}

/** A table extracted from the document, represented as markdown. */
export interface NormalizedTable {
	tableIndex: number;
	pageIndex: number;
	/** Markdown representation of the table (pipe-delimited). */
	markdown: string;
	rowCount: number;
	columnCount: number;
}

/** A hyperlink found within the document. */
export interface NormalizedLink {
	text: string;
	url: string;
	pageIndex: number;
}

/** A warning raised during OCR processing, scoped to a page or the whole document. */
export interface OcrWarning {
	code: string;
	message: string;
	/** The page this warning applies to, or undefined for document-level warnings. */
	pageIndex?: number;
	severity: 'low' | 'medium' | 'high';
}

/** Metadata about the OCR provider that processed the document. */
export interface OcrProviderMetadata {
	provider: 'mistral';
	model: string;
	processingTimeMs: number;
	rawPageCount: number;
}
