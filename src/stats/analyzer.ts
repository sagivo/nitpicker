export type Severity = "critical" | "warning" | "suggestion";
export type Outcome = "accepted" | "rejected" | "ignored";

export interface ReactionData {
  plusOne: number;
  minusOne: number;
  heart: number;
  hooray: number;
  rocket: number;
  confused: number;
  laugh: number;
  eyes: number;
}

export interface ThreadReply {
  user: string;
  body: string;
  createdAt: string;
}

export interface SuggestionSignals {
  reactions: ReactionData;
  replies: ThreadReply[];
  /** Whether a commit after this comment modified the same file */
  fileChangedAfterComment: boolean;
  botUsername: string;
}

export interface OutcomeResult {
  outcome: Outcome;
  reason: string;
  positiveReactions: number;
  negativeReactions: number;
  replyCount: number;
}

const ACCEPTANCE_PATTERNS = [
  /\bfix(?:ed|ing)?\b/i,
  /\bgood\s+catch\b/i,
  /\bdone\b/i,
  /\bapplied\b/i,
  /\bthanks?\b/i,
  /\bthank\s+you\b/i,
  /\bwill\s+fix\b/i,
  /\bagreed?\b/i,
  /\bmakes?\s+sense\b/i,
  /\byou'?re\s+right\b/i,
  /\bgood\s+point\b/i,
  /\bupdated\b/i,
  /\baddressed\b/i,
  /\bresolved\b/i,
  /\b(?:thumbs?\s*up|👍)\b/i,
];

const REJECTION_PATTERNS = [
  /\bwon'?t\s+fix\b/i,
  /\bdisagree\b/i,
  /\bnot\s+relevant\b/i,
  /\bintentional\b/i,
  /\bby\s+design\b/i,
  /\bnah\b/i,
  /\bignor(?:e|ing)\b/i,
  /\bnot\s+(?:a\s+)?(?:bug|issue|problem)\b/i,
  /\bfalse\s+positive\b/i,
  /\bwon'?t\s+change\b/i,
  /\bleaving\s+as[\s-]is\b/i,
  /\b(?:thumbs?\s*down|👎)\b/i,
];

function countPositiveReactions(r: ReactionData): number {
  return r.plusOne + r.heart + r.hooray + r.rocket;
}

function countNegativeReactions(r: ReactionData): number {
  return r.minusOne + r.confused;
}

/**
 * Analyze reply text for acceptance/rejection signals.
 * Only considers replies from non-bot users.
 */
function analyzeReplies(
  replies: ThreadReply[],
  botUsername: string,
): { acceptSignals: number; rejectSignals: number; reasons: string[] } {
  let acceptSignals = 0;
  let rejectSignals = 0;
  const reasons: string[] = [];

  const humanReplies = replies.filter(
    (r) => r.user.toLowerCase() !== botUsername.toLowerCase(),
  );

  for (const reply of humanReplies) {
    const body = reply.body;

    for (const pattern of ACCEPTANCE_PATTERNS) {
      if (pattern.test(body)) {
        acceptSignals++;
        reasons.push(`reply matched acceptance pattern: ${pattern.source}`);
        break;
      }
    }

    for (const pattern of REJECTION_PATTERNS) {
      if (pattern.test(body)) {
        rejectSignals++;
        reasons.push(`reply matched rejection pattern: ${pattern.source}`);
        break;
      }
    }
  }

  return { acceptSignals, rejectSignals, reasons };
}

/**
 * Determine the outcome of a bot suggestion based on multiple signals.
 *
 * Priority:
 * 1. Explicit reactions (strongest signal)
 * 2. Reply sentiment
 * 3. File-level code changes (weakest, supporting signal)
 */
export function determineOutcome(signals: SuggestionSignals): OutcomeResult {
  const positiveReactions = countPositiveReactions(signals.reactions);
  const negativeReactions = countNegativeReactions(signals.reactions);
  const humanReplies = signals.replies.filter(
    (r) => r.user.toLowerCase() !== signals.botUsername.toLowerCase(),
  );
  const replyCount = humanReplies.length;

  const replyAnalysis = analyzeReplies(signals.replies, signals.botUsername);

  let acceptScore = 0;
  let rejectScore = 0;
  const reasons: string[] = [];

  // Reactions carry heavy weight
  if (positiveReactions > 0) {
    acceptScore += positiveReactions * 3;
    reasons.push(`${positiveReactions} positive reaction(s)`);
  }
  if (negativeReactions > 0) {
    rejectScore += negativeReactions * 3;
    reasons.push(`${negativeReactions} negative reaction(s)`);
  }

  // Reply sentiment
  if (replyAnalysis.acceptSignals > 0) {
    acceptScore += replyAnalysis.acceptSignals * 2;
    reasons.push(...replyAnalysis.reasons);
  }
  if (replyAnalysis.rejectSignals > 0) {
    rejectScore += replyAnalysis.rejectSignals * 2;
    reasons.push(...replyAnalysis.reasons);
  }

  // File-level code change is a weak supporting signal
  // if (signals.fileChangedAfterComment) {
  //   acceptScore += 1;
  //   reasons.push("file modified in a subsequent commit");
  // }

  let outcome: Outcome;
  if (acceptScore === 0 && rejectScore === 0) {
    outcome = "ignored";
  } else if (acceptScore > rejectScore) {
    outcome = "accepted";
  } else if (rejectScore > acceptScore) {
    outcome = "rejected";
  } else {
    // Tie — if there are positive reactions at all, lean accepted
    outcome = positiveReactions > 0 ? "accepted" : "ignored";
  }

  return {
    outcome,
    reason: reasons.length > 0 ? reasons.join("; ") : "no engagement signals",
    positiveReactions,
    negativeReactions,
    replyCount,
  };
}

const SEVERITY_MAP: Record<string, Severity> = {
  "🔴": "critical",
  "🟡": "warning",
  "🔵": "suggestion",
};

/**
 * Parse severity from a bot comment body.
 * Expected format: `🔴 **critical**`, `🟡 **warning**`, or `🔵 **suggestion**`
 */
export function parseSeverity(body: string): Severity | null {
  const match = body.match(/(🔴|🟡|🔵)\s*\*\*(\w+)\*\*/);
  if (match) {
    const fromEmoji = SEVERITY_MAP[match[1]];
    if (fromEmoji) return fromEmoji;

    const label = match[2].toLowerCase();
    if (label === "critical" || label === "warning" || label === "suggestion") {
      return label;
    }
  }
  return null;
}
