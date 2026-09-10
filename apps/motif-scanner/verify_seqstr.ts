
import { parseSeqstr } from './services/seqstrParser';
import { fetchSegmentSequence } from './services/ucscFetcher';

// Test cases from https://github.com/jzhoulab/Seqstr/blob/master/tests/test.py
const testCases = [
    { name: 'base', input: '[hg38]chr7:5480600-5480620 +', expected: 'TTGTCCAGGCTGGAGTGCAA' },
    { name: 'base rev', input: 'chr7:5480600-5480620 -', expected: 'TTGCACTCCAGCCTGGACAA' }, // Note: Genome missing, defaults to hg38?
    { name: 'insertion', input: '[hg38]chr7:5480600-5480620 +, @chr7 5480600 T TA', expected: 'TATGTCCAGGCTGGAGTGCAA' },
    { name: 'deletion', input: '[hg38]chr7:5480600-5480620 +, @chr7 5480600 TT T', expected: 'TGTCCAGGCTGGAGTGCAA' },
    { name: 'indel', input: '[hg38]chr7:5480600-5480620 +, @chr7 5480600 TT T, @chr7 5480619 A AT', expected: 'TGTCCAGGCTGGAGTGCAAT' },
    { name: 'indel,concat', input: '[hg38]chr7:5480600-5480620 +, @chr7 5480600 TT T, @chr7 5480619 A AT;TATA;', expected: 'TGTCCAGGCTGGAGTGCAATTATA' },
    { name: 'indel,concat,indel', input: '[hg38]chr7:5480600-5480610 +, @chr7 5480600 TT T;TATA;[hg38]chr7:5480610-5480620 +, @chr7 5480619 A AT;', expected: 'TGTCCAGGCTATATGGAGTGCAAT' },
    { name: 'concat,indel,concat', input: 'CG;[hg38]chr7:5480600-5480620 +, @chr7 5480619 A AT, @chr7 5480600 TT T;TA;', expected: 'CGTGTCCAGGCTGGAGTGCAATTA' },
    { name: 'concat,indel,concat,indel', input: 'CG;[hg38]chr7:5480600-5480610 +, @chr7 5480600 TT T;TA;[hg38]chr7:5480610-5480620 +, @chr7 5480619 A AT', expected: 'CGTGTCCAGGCTATGGAGTGCAAT' },
    { name: 'insertion rev', input: '[hg38]chr7:5480600-5480620 -, @chr7 5480600 T TA', expected: 'TTGCACTCCAGCCTGGACATA' },
    { name: 'deletion rev', input: '[hg38]chr7:5480600-5480620 -, @chr7 5480600 TT T', expected: 'TTGCACTCCAGCCTGGACA' },
    { name: 'indel rev', input: '[hg38]chr7:5480600-5480620 -, @chr7 5480600 TT T, @chr7 5480619 A AT', expected: 'ATTGCACTCCAGCCTGGACA' },
    { name: 'indel rev,concat', input: '[hg38]chr7:5480600-5480620 -, @chr7 5480600 TT T, @chr7 5480619 A AT;TATA;', expected: 'ATTGCACTCCAGCCTGGACATATA' },
    { name: 'indel rev,concat,indel rev', input: '[hg38]chr7:5480600-5480610 -, @chr7 5480600 TT T;TATA;[hg38]chr7:5480610-5480620 -, @chr7 5480619 A AT;', expected: 'GCCTGGACATATAATTGCACTCCA' },
    { name: 'indel rev,concat,indel', input: '[hg38]chr7:5480600-5480610 -, @chr7 5480600 TT T;TATA;[hg38]chr7:5480610-5480620 +, @chr7 5480619 A AT;', expected: 'GCCTGGACATATATGGAGTGCAAT' },
    { name: 'indel,concat,indel rev', input: '[hg38]chr7:5480600-5480610 +, @chr7 5480600 TT T;TATA;[hg38]chr7:5480610-5480620 -, @chr7 5480619 A AT;', expected: 'TGTCCAGGCTATAATTGCACTCCA' },
    { name: 'spacing', input: '[hg38]chr7:5480600-5480610  + , @chr7  5480600  TT  T ; TATA ; [hg38]chr7:5480610-5480620  + , @chr7  5480619  A  AT ;', expected: 'TGTCCAGGCTATATGGAGTGCAAT' }
];

async function runTests() {
    console.log('Running Seqstr Verification Tests...');
    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
        console.log(`Test: ${tc.name}`);
        try {
            const parsed = parseSeqstr(tc.input);
            // Assuming single sequence output for these tests (no newlines in input)
            if (parsed.length !== 1) {
                throw new Error(`Expected 1 sequence, got ${parsed.length}`);
            }

            const item = parsed[0];
            let fullSeq = "";
            for (const seg of item.segments) {
                // We need to handle default genome if missing.
                // The parser defaults to hg38 if missing in the regex logic?
                // Let's check parser logic.
                if (seg.type === 'interval' && !seg.genome) seg.genome = 'hg38';

                fullSeq += await fetchSegmentSequence(seg);
            }

            if (fullSeq === tc.expected) {
                console.log('PASS');
                passed++;
            } else {
                console.error(`FAIL: Expected ${tc.expected}, got ${fullSeq}`);
                failed++;
            }
        } catch (err: any) {
            console.error(`ERROR: ${err.message}`);
            failed++;
        }
        console.log('---');
    }

    console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
}

runTests();
