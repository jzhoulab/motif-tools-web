// HOCOMOCO v14 ids use UniProt entry names (truncated to 5 chars) and Vierstra /
// CIS-BP use their own shorthands. Normalise every symbol we see to an HGNC-style
// gene symbol so that one factor is one factor across the four databases.
export const EXPLICIT = {
    ANDR: 'AR', GCR: 'NR3C1', MCR: 'NR3C2', PRGR: 'PGR', ESR: 'ESR1',
    THA: 'THRA', THB: 'THRB', ERR1: 'ESRRA', ERR2: 'ESRRB', ERR3: 'ESRRG',
    COT1: 'NR2F1', COT2: 'NR2F2', STF1: 'NR5A1', NR6A: 'NR6A1',
    PIT1: 'POU1F1', SUH: 'RBPJ', KAISO: 'ZBTB33', TYY1: 'YY1', TYY2: 'YY2',
    MECP: 'MECP2', HME1: 'EN1', HME2: 'EN2', PHX2A: 'PHOX2A', PHX2B: 'PHOX2B',
    TWST1: 'TWIST1', TWST2: 'TWIST2', NDF1: 'NEUROD1', NDF2: 'NEUROD2',
    NGN1: 'NEUROG1', NGN2: 'NEUROG2', HEN1: 'NHLH1', HEN2: 'NHLH2',
    ITF2: 'TCF4', HTF4: 'TCF12', TFE2: 'TCF3', MYOD: 'MYOD1', MAD4: 'MXD4',
    MXI: 'MXI1', COE1: 'EBF1', COE2: 'EBF2', COE3: 'EBF3', LYL: 'LYL1', TAL: 'TAL1',
    MSD1: 'MSANTD1', MSD4: 'MSANTD4', TDIF1: 'DNTTIP1', TF2L1: 'TFCP2L1',
    UBIP1: 'UBP1', P5F1B: 'POU5F1B', P53: 'TP53', P63: 'TP63', P73: 'TP73',
    P66A: 'GATAD2A', GTD2A: 'GATAD2A', F200B: 'FAM200B', FWCH1: 'FLYWCH1',
    HM20A: 'HMG20A', HMBX1: 'HMBOX1', JERKY: 'JRK', LRRF1: 'LRRFIP1',
    MGAP: 'MGA', MRFL: 'MYRFL', MUSC: 'MSC', MLXPL: 'MLXIPL', OZF: 'ZNF146',
    S2A4R: 'SLC2A4RG', SETBP: 'SETBP1', SOLH2: 'SOHLH2', SP14L: 'SP140L',
    STA5A: 'STAT5A', STA5B: 'STAT5B', TSH2: 'TSHZ2', TZAP: 'ZBTB48',
    YBOX1: 'YBX1', YBX: 'YBX1', ZGLP: 'ZGLP1', ZIK: 'ZIK1', ZZZ: 'ZZZ3',
    ELYS: 'AHCTF1', CGBP1: 'CXXC1', DMTA2: 'DMRTA2', FXL19: 'FBXL19',
    HNF6: 'ONECUT1', NFAT: 'NFATC1', NFE: 'NFE2', NFE2L: 'NFE2L1',
    TF65: 'RELA', TFDP: 'TFDP1', ARI1A: 'ARID1A', ATF6A: 'ATF6',
    BARH1: 'BARHL1', BARH2: 'BARHL2', BMAL: 'ARNTL', CENPBD: 'CENPBD1',
    DPF: 'DPF1', DNMT: 'DNMT1', FER3L: 'FERD3L', FOG1: 'ZFPM1', FOG: 'ZFPM1',
    HXA1: 'HOXA1', KMT2B: 'KMT2B', LEUTX: 'LEUTX', PROP: 'PROP1',
    RHXF1: 'RHOXF1', RHXF2: 'RHOXF2', RHOX11: 'RHOXF1', RHOXF: 'RHOXF1',
    SRBP1: 'SREBF1', SRBP2: 'SREBF2', TFCP2L: 'TFCP2L1', TGIF2LX: 'TGIF2LX',
    ZBT7B: 'ZBTB7B', ZBT7C: 'ZBTB7C', ZBT8A: 'ZBTB8A', ZBT8B: 'ZBTB8B',
    ZF64B: 'ZFP64', ZF69B: 'ZFP69B', ZFTA: 'ZFTA', PO2F1: 'POU2F1',
    HTF: 'TCF12', SPZ: 'SPZ1', MIX: 'MIXL1', 'MIX-A': 'MIXL1', EWSR: 'FLI1',
    'EWSR1-FLI1': 'FLI1', 'BORCS8-MEF2B': 'MEF2B', BORCS: 'MEF2B',
    NKX21: 'NKX2-1', NKX22: 'NKX2-2', NKX23: 'NKX2-3', NKX25: 'NKX2-5',
    NKX28: 'NKX2-8', NKX31: 'NKX3-1', NKX32: 'NKX3-2', NKX61: 'NKX6-1',
    NKX62: 'NKX6-2', NKX63: 'NKX6-3', UNC4: 'UNCX', HXA9: 'HOXA9',
    RX: 'RAX', ALX: 'ALX1', BSH: 'BSX', PRD10: 'PRDM10', PRD13: 'PRDM13',
    PRD14: 'PRDM14', PRD15: 'PRDM15', PRD16: 'PRDM16', DMRTD: 'DMRTC1',
    ATOH8: 'ATOH8', TTF: 'TTF1', TF: 'TFAP2A', TP: 'TP53', T: 'TBXT',
    HKR: 'ZNF875', HKR1: 'ZNF875', ZIM: 'ZIM2', SPI: 'SPI1', ZSA5A: 'ZSCAN5A',
    ZSA5C: 'ZSCAN5C', ZN33B: 'ZNF33B', ZN37A: 'ZNF37A', ZN75A: 'ZNF75A',
    ZN75D: 'ZNF75D', MBD: 'MBD1', PHF: 'PHF1', XPA: 'XPA', TAF: 'TAF1',
};
// Mechanical rewrites, applied in order when no explicit alias matches.
export const RULES = [
    [/^HX([ABCD])(\d+)$/, (m) => `HOX${m[1]}${m[2]}`],
    [/^PO(\d)F(\d[A-Z]?)$/, (m) => `POU${m[1]}F${m[2]}`],
    [/^ZN(\d+[A-Z]?)$/, (m) => `ZNF${m[1]}`],
    [/^Z(\d{3}[A-Z])$/, (m) => `ZNF${m[1]}`],
    [/^ZBT(\d+[A-Z]?)$/, (m) => `ZBTB${m[1]}`],
    [/^ZSC(\d+[A-Z]?)$/, (m) => `ZSCAN${m[1]}`],
    [/^ZSCA(\d+[A-Z]?)$/, (m) => `ZSCAN${m[1]}`],
    [/^ZKSC(\d+[A-Z]?)$/, (m) => `ZKSCAN${m[1]}`],
    [/^ZF(\d+[AB]?)$/, (m) => `ZFP${m[1]}`],
    [/^NFAC(\d)$/, (m) => `NFATC${m[1]}`],
    [/^NF2L(\d)$/, (m) => `NFE2L${m[1]}`],
    [/^CR3L(\d)$/, (m) => `CREB3L${m[1]}`],
    [/^PKNX(\d)$/, (m) => `PKNOX${m[1]}`],
    [/^ONEC(\d)$/, (m) => `ONECUT${m[1]}`],
    [/^TF7L(\d)$/, (m) => `TCF7L${m[1]}`],
    [/^TF2L([XY])$/, (m) => `TGIF2L${m[1]}`],
    [/^BHA(\d+)$/, (m) => `BHLHA${m[1]}`],
    [/^BHE(\d+)$/, (m) => `BHLHE${m[1]}`],
    [/^CMTA(\d)$/, (m) => `CAMTA${m[1]}`],
    [/^MZF$/, () => 'MZF1'],
];
export function normalize(sym) {
    const s = String(sym || '').toUpperCase().trim();
    if (EXPLICIT[s]) return EXPLICIT[s];
    for (const [re, fn] of RULES) { const m = s.match(re); if (m) return fn(m); }
    return s;
}
