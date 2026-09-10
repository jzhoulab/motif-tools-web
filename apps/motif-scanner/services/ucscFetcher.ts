
import { SeqstrSegment } from './seqstrParser';

const UCSC_API_BASE = 'https://api.genome.ucsc.edu';

export async function fetchSegmentSequence(segment: SeqstrSegment): Promise<string> {
    if (segment.type === 'sequence' && segment.rawSequence) {
        return segment.rawSequence;
    }

    if (segment.type === 'interval') {
        if (!segment.genome || !segment.chrom || segment.start === undefined || segment.end === undefined) {
            throw new Error('Invalid interval segment');
        }

        // UCSC API: /getData/sequence?genome=hg38;chrom=chr7;start=5530575;end=5530625
        // Note: UCSC API is 0-based start, half-open? 
        // Actually UCSC API docs say: "start and end coordinates are 0-based... inclusive for start, exclusive for end"
        // This matches Seqstr spec.

        const url = `${UCSC_API_BASE}/getData/sequence?genome=${segment.genome}&chrom=${segment.chrom}&start=${segment.start}&end=${segment.end}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`UCSC API Error: ${response.statusText} - ${errText}`);
            }

            const data = await response.json();
            // data.dna is the sequence
            let seq = data.dna;

            if (!seq) throw new Error('No sequence returned from UCSC');

            // Apply mutations if any
            if (segment.mutations && segment.mutations.length > 0) {
                seq = applyMutations(seq, segment.start, segment.mutations);
            }

            // Handle Reverse Complement
            if (segment.strand === '-') {
                seq = reverseComplement(seq);
            }

            return seq.toUpperCase();
        } catch (err: any) {
            console.error('Fetch error:', err);
            throw new Error(`Failed to fetch sequence for ${segment.genome}:${segment.chrom}:${segment.start}-${segment.end}: ${err.message}`);
        }
    }

    return '';
}

function applyMutations(seq: string, startCoord: number, mutations: any[]): string {
    // Mutations are @chr pos ref alt
    // pos is 0-based genomic coordinate.
    // We need to map it to the sequence index.
    // index = pos - startCoord

    // Sort mutations by position descending to avoid index shifting issues if length changes (though spec says "Overlapping mutations are not allowed")
    // But wait, if we replace 1 base with 2, indices shift.
    // So we should process from right to left (highest index to lowest).

    const sortedMutations = [...mutations].sort((a, b) => b.pos - a.pos);

    let mutatedSeq = seq;

    for (const mut of sortedMutations) {
        const index = mut.pos - startCoord;

        if (index < 0 || index >= mutatedSeq.length) {
            console.warn(`Mutation at ${mut.pos} is out of bounds for interval starting at ${startCoord}`);
            continue;
        }

        // Verify ref allele matches?
        // The spec says "change from reference_allele to alternative_allele".
        // It's good practice to check, but maybe not strictly required to crash.
        // Let's just replace.

        // We need to handle multi-base replacements.
        // The ref allele length tells us how much to remove.
        const refLen = mut.ref.length;

        // Check if ref matches what's there
        const currentRef = mutatedSeq.substring(index, index + refLen);
        if (currentRef.toUpperCase() !== mut.ref.toUpperCase()) {
            console.warn(`Mutation ref mismatch at ${mut.pos}: expected ${mut.ref}, found ${currentRef}`);
        }

        const before = mutatedSeq.substring(0, index);
        const after = mutatedSeq.substring(index + refLen);
        mutatedSeq = before + mut.alt + after;
    }

    return mutatedSeq;
}

function reverseComplement(seq: string): string {
    const complement: Record<string, string> = {
        'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C',
        'a': 't', 't': 'a', 'c': 'g', 'g': 'c',
        'N': 'N', 'n': 'n'
    };
    return seq.split('').reverse().map(base => complement[base] || base).join('');
}
