
export interface SeqstrSegment {
    type: 'interval' | 'sequence';
    genome?: string;
    chrom?: string;
    start?: number;
    end?: number;
    strand?: '+' | '-';
    rawSequence?: string;
    mutations?: SeqstrMutation[];
}

export interface SeqstrMutation {
    chrom: string;
    pos: number;
    ref: string;
    alt: string;
}

export interface ParsedSeqstr {
    name: string;
    segments: SeqstrSegment[];
}

/**
 * Parses a full Seqstr input (potentially multiple lines)
 */
export function parseSeqstr(input: string): ParsedSeqstr[] {
    const lines = input.trim().split(/\r?\n/);
    const results: ParsedSeqstr[] = [];

    lines.forEach((line, index) => {
        if (!line.trim()) return;
        results.push(parseSingleSeqstrLine(line, index));
    });

    return results;
}

function parseSingleSeqstrLine(line: string, index: number): ParsedSeqstr {
    let name = `s${index}`;
    let content = line.trim();

    // Check for name <name>
    const nameMatch = content.match(/^<([^>]+)>(.*)/);
    if (nameMatch) {
        name = nameMatch[1];
        content = nameMatch[2].trim();
    }

    // Split by semicolon for segments
    const segmentStrings = content.split(';');
    const segments: SeqstrSegment[] = [];

    for (const segStr of segmentStrings) {
        if (!segStr.trim()) continue;
        segments.push(parseSegment(segStr));
    }

    return { name, segments };
}

function parseSegment(segmentStr: string): SeqstrSegment {
    // Check for mutations: separated by comma
    // Example: [hg38]chr7:5530575-5530625 -, @chr7 5530575 C T

    const parts = segmentStr.split(',');
    const mainPart = parts[0].trim();
    const mutationParts = parts.slice(1);

    let segment: SeqstrSegment;

    // Regex for interval: [genome]chr:start-end strand
    // Genome is optional in regex but required for fetching usually, default might be hg38 if missing? 
    // The spec says: [reference_genome]chr:start-end strand
    // Let's be flexible.
    const intervalRegex = /^(\[([^\]]+)\])?([^:]+):(\d+)-(\d+)\s*([+-])?$/;
    const match = mainPart.match(intervalRegex);

    if (match) {
        segment = {
            type: 'interval',
            genome: match[2] || 'hg38', // Default to hg38 if not specified? Spec says "if not specified, the default is hg38"
            chrom: match[3],
            start: parseInt(match[4], 10),
            end: parseInt(match[5], 10),
            strand: (match[6] as '+' | '-') || '+'
        };
    } else {
        // It's a raw sequence
        // Check if it looks like a malformed interval (contains [, ], :, or @)
        // If so, throw error to avoid treating partial inputs as raw sequences
        if (/[\[\]:@]/.test(mainPart)) {
            throw new Error(`Invalid segment format: ${mainPart}`);
        }

        segment = {
            type: 'sequence',
            rawSequence: mainPart
        };
    }

    // Parse mutations
    if (mutationParts.length > 0) {
        segment.mutations = [];
        for (const mutStr of mutationParts) {
            // @chr position ref alt
            const mutMatch = mutStr.trim().match(/^@(\S+)\s+(\d+)\s+(\S+)\s+(\S+)$/);
            if (mutMatch) {
                segment.mutations.push({
                    chrom: mutMatch[1],
                    pos: parseInt(mutMatch[2], 10),
                    ref: mutMatch[3],
                    alt: mutMatch[4]
                });
            }
        }
    }

    return segment;
}
