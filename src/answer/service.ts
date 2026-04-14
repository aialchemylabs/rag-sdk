import type { ValidatedConfig } from '../config/validate.js';
import { RagErrorCode } from '../errors/errorCodes.js';
import { RagSdkError } from '../errors/ragError.js';
import type { ChatProvider } from '../llmProviders/llmProvider.types.js';
import type { RetrieveService } from '../retrieve/service.js';
import type { TelemetryEmitter } from '../telemetry/emitter.js';
import type { AnswerCitation, AnswerOptions, AnswerResult } from './answer.types.js';
import type { RetrieveMatch } from '../retrieve/retrieve.types.js';

interface CitationValidation {
	validReferencedIndices: Set<number>;
	invalidReferencedIndices: Set<number>;
}

export class AnswerService {
	constructor(
		private readonly config: ValidatedConfig,
		private readonly answerProvider: ChatProvider,
		private readonly retriever: RetrieveService,
		private readonly telemetry: TelemetryEmitter,
	) {}

	async answer(query: string, options?: AnswerOptions): Promise<AnswerResult> {
		const startTime = Date.now();
		const answeringConfig = this.config.answering;

		if (!answeringConfig) {
			throw new RagSdkError(
				RagErrorCode.NOT_CONFIGURED,
				'Answer generation is not configured. Provide an answering config in createRag().',
			);
		}

		const noCitationPolicy = options?.noCitationPolicy ?? answeringConfig.noCitationPolicy;
		const telemetry = this.telemetry.withOverride(options?.telemetry?.onEvent);
		const tenantId = options?.security?.tenantId;

		telemetry.emit('answer_generation_started', {
			tenantId,
			metadata: { query: query.substring(0, 100), noCitationPolicy },
		});

		try {
			// Step 1: Retrieve relevant chunks — propagate per-call telemetry so
			// retrieval events are delivered to the same handler as the answer events.
			const retrieveStartTime = Date.now();
			const retrievalResult = await this.retriever.query(query, {
				topK: options?.topK,
				scoreThreshold: options?.scoreThreshold,
				filters: options?.filters,
				security: options?.security,
				telemetry: options?.telemetry,
			});
			const retrievalTimeMs = Date.now() - retrieveStartTime;

			// Step 2: Check if we have sufficient evidence
			if (retrievalResult.matches.length === 0) {
				const noEvidenceResult = this.handleNoEvidence(query, noCitationPolicy, retrievalTimeMs, startTime);
				telemetry.emit('answer_generation_executed', {
					durationMs: noEvidenceResult.totalTimeMs,
					tenantId,
					metadata: {
						query: query.substring(0, 100),
						matchCount: 0,
						riskLevel: noEvidenceResult.riskLevel,
						outcome: 'no_evidence',
					},
				});
				return noEvidenceResult;
			}

			// Step 3: Build context and generate answer
			const generationStartTime = Date.now();
			const context = this.buildContext(retrievalResult.matches);
			const systemPrompt = this.buildSystemPrompt(noCitationPolicy);
			const chatOptions = {
				maxTokens: options?.maxTokens ?? answeringConfig.maxTokens,
				temperature: options?.temperature ?? answeringConfig.temperature,
			};

			let response = await this.answerProvider.generateChatCompletion(
				[
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: `Context:\n${context}\n\nQuestion: ${query}` },
				],
				chatOptions,
			);

			let generationTimeMs = Date.now() - generationStartTime;

			// Step 4: Build citations and validate claim-to-citation linkage
			const allCitations = this.buildCitations(retrievalResult.matches);
			let citationValidation = this.validateCitationIndices(response.content, retrievalResult.matches.length);

			const MAX_CITATION_REPAIR_ATTEMPTS = 2;
			let repairAttempts = 0;

			while (this.shouldRepairCitations(citationValidation) && repairAttempts < MAX_CITATION_REPAIR_ATTEMPTS) {
				repairAttempts++;
				const repairStartTime = Date.now();
				response = await this.answerProvider.generateChatCompletion(
					[
						{
							role: 'system',
							content: this.buildCitationRepairPrompt(systemPrompt, retrievalResult.matches.length),
						},
						{
							role: 'user',
							content: this.buildCitationRepairRequest(
								context,
								query,
								response.content,
								citationValidation,
								retrievalResult.matches.length,
							),
						},
					],
					chatOptions,
				);
				generationTimeMs += Date.now() - repairStartTime;
				citationValidation = this.validateCitationIndices(response.content, retrievalResult.matches.length);
			}

			const { validReferencedIndices, invalidReferencedIndices } = citationValidation;
			if (invalidReferencedIndices.size > 0 || validReferencedIndices.size === 0) {
				const violationResult = this.handleCitationContractViolation(
					noCitationPolicy,
					retrievalTimeMs,
					generationTimeMs,
					startTime,
					invalidReferencedIndices,
				);
				telemetry.emit('answer_generation_executed', {
					durationMs: violationResult.totalTimeMs,
					tenantId,
					metadata: {
						query: query.substring(0, 100),
						matchCount: retrievalResult.matches.length,
						riskLevel: violationResult.riskLevel,
						outcome: 'citation_violation',
						invalidMarkers: [...invalidReferencedIndices],
					},
				});
				return violationResult;
			}

			const citations = allCitations.filter((c) => validReferencedIndices.has(c.citationIndex));

			const confidence = this.assessConfidence(retrievalResult.matches);
			const riskLevel = this.assessRisk(retrievalResult.matches, confidence);
			const disclaimer: string | undefined =
				riskLevel !== 'safe'
					? 'This answer may have limited supporting evidence. Please verify with original sources.'
					: undefined;

			const totalTimeMs = Date.now() - startTime;

			telemetry.emit('answer_generation_executed', {
				durationMs: totalTimeMs,
				tenantId,
				metadata: {
					query: query.substring(0, 100),
					matchCount: retrievalResult.matches.length,
					citedSourceCount: validReferencedIndices.size,
					confidence,
					riskLevel,
				},
			});

			return {
				answer: response.content,
				citations,
				confidence,
				riskLevel,
				disclaimer,
				sources: retrievalResult.matches
					.filter((_, i) => validReferencedIndices.has(i + 1))
					.map((m) => ({
						documentId: m.documentId,
						sourceName: m.metadata.sourceName,
						pageRange: `${m.metadata.pageStart}-${m.metadata.pageEnd}`,
					})),
				retrievalTimeMs,
				generationTimeMs,
				totalTimeMs,
			};
		} catch (err) {
			telemetry.emit('answer_generation_failed', {
				durationMs: Date.now() - startTime,
				tenantId,
				error: err instanceof Error ? err.message : String(err),
				metadata: { query: query.substring(0, 100) },
			});
			if (err instanceof RagSdkError) throw err;
			throw new RagSdkError(
				RagErrorCode.ANSWER_PROVIDER_ERROR,
				`Answer generation failed: ${err instanceof Error ? err.message : String(err)}`,
				{ retryable: true, cause: err instanceof Error ? err : undefined },
			);
		}
	}

	private handleNoEvidence(_query: string, policy: string, retrievalTimeMs: number, startTime: number): AnswerResult {
		const totalTimeMs = Date.now() - startTime;

		if (policy === 'refuse') {
			return {
				answer: 'I cannot provide an answer as no supporting evidence was found in the available documents.',
				citations: [],
				confidence: 'none',
				riskLevel: 'no_evidence',
				disclaimer: 'No relevant documents were found to support an answer to this question.',
				sources: [],
				retrievalTimeMs,
				generationTimeMs: 0,
				totalTimeMs,
			};
		}

		if (policy === 'warn') {
			return {
				answer: 'No sufficient evidence was found. Any response would be unsupported by the available documents.',
				citations: [],
				confidence: 'none',
				riskLevel: 'no_evidence',
				disclaimer: 'WARNING: This response is not supported by any retrieved evidence.',
				sources: [],
				retrievalTimeMs,
				generationTimeMs: 0,
				totalTimeMs,
			};
		}

		// policy === 'allow'
		return {
			answer: '',
			citations: [],
			confidence: 'none',
			riskLevel: 'no_evidence',
			sources: [],
			retrievalTimeMs,
			generationTimeMs: 0,
			totalTimeMs,
		};
	}

	private handleCitationContractViolation(
		policy: string,
		retrievalTimeMs: number,
		generationTimeMs: number,
		startTime: number,
		invalidReferencedIndices: Set<number>,
	): AnswerResult {
		const totalTimeMs = Date.now() - startTime;
		const invalidMarkers = [...invalidReferencedIndices].sort((a, b) => a - b);
		const invalidCitationDetails =
			invalidMarkers.length > 0
				? ` Invalid citation markers detected: ${invalidMarkers.map((i) => `[${i}]`).join(', ')}.`
				: '';
		const withheldMessage =
			policy === 'allow'
				? ''
				: 'Unable to produce a sufficiently cited answer. The generated response could not be verified against source citations.';

		return {
			answer: withheldMessage,
			citations: [],
			confidence: 'none',
			riskLevel: 'low_evidence',
			disclaimer: `The model produced missing or invalid citation references.${invalidCitationDetails} The response was withheld to comply with the no-citation-no-claim policy.`,
			sources: [],
			retrievalTimeMs,
			generationTimeMs,
			totalTimeMs,
		};
	}

	private buildContext(matches: RetrieveMatch[]): string {
		return matches
			.map((match, index) => {
				const source = `[${index + 1}] ${match.metadata.sourceName} (pages ${match.metadata.pageStart}-${match.metadata.pageEnd})`;
				return `${source}\n${match.content}`;
			})
			.join('\n\n---\n\n');
	}

	private buildSystemPrompt(policy: string): string {
		const base = `You are a precise, citation-aware assistant. Answer questions based ONLY on the provided context.

Rules:
- Every claim must be supported by the provided context
- Reference sources using [N] notation corresponding to the context numbers
- If the context does not contain sufficient information, say so clearly`;

		if (policy === 'refuse') {
			return `${base}
- If you cannot find evidence for any part of the answer, refuse to answer that part
- Never make claims that go beyond what the sources support
- Policy: NO CITATION = NO CLAIM. Every statement must have a source reference.`;
		}

		if (policy === 'warn') {
			return `${base}
- If evidence is weak or partial, clearly mark those parts as uncertain
- Distinguish between well-supported claims and inferences`;
		}

		return base;
	}

	private buildCitationRepairPrompt(systemPrompt: string, maxCitationIndex: number): string {
		return `${systemPrompt}
- You may only cite sources using [N] where N is between 1 and ${maxCitationIndex}
- Remove any claim that cannot be supported by the provided sources
- If the context is insufficient, say so explicitly instead of guessing
- Do not include any citation markers outside the allowed range`;
	}

	private buildCitationRepairRequest(
		context: string,
		query: string,
		previousAnswer: string,
		citationValidation: CitationValidation,
		maxCitationIndex: number,
	): string {
		const invalidMarkers = [...citationValidation.invalidReferencedIndices]
			.sort((a, b) => a - b)
			.map((index) => `[${index}]`);
		const issueSummary =
			invalidMarkers.length > 0
				? `Invalid citations detected: ${invalidMarkers.join(', ')}.`
				: 'The previous answer did not include any valid inline citations.';

		return `Context:\n${context}\n\nQuestion: ${query}\n\nPrevious answer:\n${previousAnswer}\n\n${issueSummary}\nRewrite the answer using only valid citations [1] through [${maxCitationIndex}]. If any claim cannot be fully supported, omit it or state that the evidence is insufficient.`;
	}

	private shouldRepairCitations(citationValidation: CitationValidation): boolean {
		return citationValidation.invalidReferencedIndices.size > 0 || citationValidation.validReferencedIndices.size === 0;
	}

	/**
	 * Parse [N] citation markers from the generated answer text and return
	 * the set of 1-based indices that the model actually referenced.
	 */
	private extractCitationIndices(answer: string): Set<number> {
		const indices = new Set<number>();
		const matches = answer.matchAll(/\[(\d+)\]/g);
		for (const m of matches) {
			indices.add(Number(m[1]));
		}
		return indices;
	}

	private validateCitationIndices(answer: string, maxCitationIndex: number): CitationValidation {
		const referencedIndices = this.extractCitationIndices(answer);
		const validReferencedIndices = new Set<number>();
		const invalidReferencedIndices = new Set<number>();

		for (const index of referencedIndices) {
			if (index >= 1 && index <= maxCitationIndex) {
				validReferencedIndices.add(index);
			} else {
				invalidReferencedIndices.add(index);
			}
		}

		return { validReferencedIndices, invalidReferencedIndices };
	}

	private buildCitations(matches: RetrieveMatch[]): AnswerCitation[] {
		return matches.map((match, index) => ({
			anchor: match.citation,
			relevanceScore: match.score,
			citationIndex: index + 1,
			text: match.content.substring(0, 300),
		}));
	}

	private assessConfidence(matches: RetrieveMatch[]): 'high' | 'medium' | 'low' | 'none' {
		if (matches.length === 0) return 'none';

		const avgScore = matches.reduce((sum, m) => sum + m.score, 0) / matches.length;
		const topScore = matches[0]?.score ?? 0;

		if (topScore >= 0.85 && avgScore >= 0.7 && matches.length >= 2) return 'high';
		if (topScore >= 0.7 && avgScore >= 0.5) return 'medium';
		if (topScore >= 0.5) return 'low';
		return 'none';
	}

	private assessRisk(matches: RetrieveMatch[], confidence: string): 'safe' | 'low_evidence' | 'no_evidence' {
		if (matches.length === 0) return 'no_evidence';
		if (confidence === 'none' || confidence === 'low') return 'low_evidence';
		return 'safe';
	}
}
