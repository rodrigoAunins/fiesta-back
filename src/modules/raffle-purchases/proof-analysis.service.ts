import { Injectable } from '@nestjs/common';
import { PaymentProofReviewStatus } from '../../common/enums/payment-proof-review-status.enum';

export type AnalyzeProofInput = {
  rawText?: string | null;
  buyerName: string;
  expectedAmount: number;
  expectedAlias?: string | null;
};

export type AnalyzeProofOutput = {
  rawExtractedText: string;
  normalizedExtractedText: string;
  detectedAmount: number | null;
  detectedPayerName: string | null;
  detectedDestinationAlias: string | null;
  ocrConfidence: number;
  validationScore: number;
  autoApprove: boolean;
  reviewStatus: PaymentProofReviewStatus;
  analysisSummary: string;
};

@Injectable()
export class ProofAnalysisService {
  analyze(input: AnalyzeProofInput): AnalyzeProofOutput {
    const raw = (input.rawText || '').trim();
    const normalized = this.normalize(raw);

    const detectedAmount = this.extractBestAmount(raw, input.expectedAmount);
    const detectedAlias = this.extractAlias(raw);
    const detectedPayerName = this.detectBuyerName(raw, input.buyerName);

    const amountScore = this.scoreAmount(detectedAmount, input.expectedAmount);
    const aliasScore = this.scoreAlias(detectedAlias, input.expectedAlias || null);
    const nameScore = this.scoreBuyerName(detectedPayerName, input.buyerName);

    const validationScore = this.clamp(amountScore + aliasScore + nameScore, 0, 100);
    const ocrConfidence = this.estimateOcrConfidence({
      normalizedText: normalized,
      detectedAmount,
      detectedAlias,
      detectedPayerName,
    });

    const autoApprove = validationScore >= 80 && ocrConfidence >= 60;

    const summaryParts = [
      `Monto detectado: ${detectedAmount !== null ? detectedAmount.toFixed(2) : 'no encontrado'}`,
      `Alias detectado: ${detectedAlias || 'no encontrado'}`,
      `Nombre detectado: ${detectedPayerName || 'no encontrado'}`,
      `OCR confidence: ${ocrConfidence}`,
      `Validation score: ${validationScore}`,
      `Resultado: ${autoApprove ? 'auto aprobado' : 'requiere revisión manual'}`,
    ];

    return {
      rawExtractedText: raw,
      normalizedExtractedText: normalized,
      detectedAmount,
      detectedPayerName,
      detectedDestinationAlias: detectedAlias,
      ocrConfidence,
      validationScore,
      autoApprove,
      reviewStatus: autoApprove
        ? PaymentProofReviewStatus.AUTO_APPROVED
        : PaymentProofReviewStatus.OCR_REVIEW,
      analysisSummary: summaryParts.join(' | '),
    };
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractBestAmount(rawText: string, expectedAmount: number): number | null {
    const candidates = this.extractAmountCandidates(rawText);
    if (!candidates.length) return null;

    let best = candidates[0];
    let bestDiff = Math.abs(best - expectedAmount);

    for (const amount of candidates) {
      const diff = Math.abs(amount - expectedAmount);
      if (diff < bestDiff) {
        best = amount;
        bestDiff = diff;
      }
    }

    return best;
  }

  private extractAmountCandidates(rawText: string): number[] {
    const cleaned = rawText.replace(/\s/g, '');
    const matches =
      cleaned.match(/\$?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\$?\d+(?:[.,]\d{2})?/g) || [];

    const parsed: number[] = [];

    for (const match of matches) {
      const normalized = match
        .replace('$', '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.');

      const n = Number(normalized);
      if (Number.isFinite(n) && n > 0) {
        parsed.push(n);
      }
    }

    return [...new Set(parsed)];
  }

  private extractAlias(rawText: string): string | null {
    const normalized = this.normalize(rawText);

    const contextualMatch =
      normalized.match(/(?:alias|destino|cuenta|a nombre de)\s*[:\-]?\s*([a-z0-9._-]{6,40})/i) ||
      normalized.match(/\b([a-z0-9]+(?:[._-][a-z0-9]+){1,5})\b/i);

    return contextualMatch?.[1] || null;
  }

  private detectBuyerName(rawText: string, buyerName: string): string | null {
    const normalizedText = this.normalize(rawText);
    const normalizedBuyer = this.normalize(buyerName);

    if (!normalizedBuyer) return null;

    const buyerTokens = normalizedBuyer.split(' ').filter(Boolean);
    if (!buyerTokens.length) return null;

    const matchedTokens = buyerTokens.filter((token) => normalizedText.includes(token));
    const ratio = matchedTokens.length / buyerTokens.length;

    if (ratio >= 0.7) {
      return buyerName;
    }

    return null;
  }

  private scoreAmount(detectedAmount: number | null, expectedAmount: number): number {
    if (detectedAmount === null) return 0;

    const diff = Math.abs(detectedAmount - expectedAmount);

    if (diff <= 0.01) return 40;
    if (diff <= Math.max(50, expectedAmount * 0.02)) return 20;
    return 0;
  }

  private scoreAlias(detectedAlias: string | null, expectedAlias: string | null): number {
    if (!expectedAlias) return 10;
    if (!detectedAlias) return 0;

    const a = this.normalize(detectedAlias);
    const b = this.normalize(expectedAlias);

    if (a === b) return 30;
    if (a.includes(b) || b.includes(a)) return 20;
    return 0;
  }

  private scoreBuyerName(detectedBuyerName: string | null, expectedBuyerName: string): number {
    if (!detectedBuyerName) return 0;

    const similarity = this.tokenSimilarity(detectedBuyerName, expectedBuyerName);

    if (similarity >= 0.9) return 20;
    if (similarity >= 0.7) return 12;
    if (similarity >= 0.5) return 6;
    return 0;
  }

  private tokenSimilarity(a: string, b: string): number {
    const tokensA = new Set(this.normalize(a).split(' ').filter(Boolean));
    const tokensB = new Set(this.normalize(b).split(' ').filter(Boolean));

    if (!tokensA.size || !tokensB.size) return 0;

    let common = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) common++;
    }

    return common / Math.max(tokensA.size, tokensB.size);
  }

  private estimateOcrConfidence(input: {
    normalizedText: string;
    detectedAmount: number | null;
    detectedAlias: string | null;
    detectedPayerName: string | null;
  }): number {
    let score = 0;

    const len = input.normalizedText.length;

    if (len >= 20) score += 20;
    if (len >= 60) score += 20;
    if (len >= 120) score += 15;

    if (input.detectedAmount !== null) score += 20;
    if (input.detectedAlias) score += 15;
    if (input.detectedPayerName) score += 10;

    return this.clamp(score, 0, 100);
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Math.round(value)));
  }
}