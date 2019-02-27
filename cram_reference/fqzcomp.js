// An arithmetic coder, based on Eugene Shelwien's reimplementation of
// Michael Schindler range coder.
//
// Order-0 byte stream of ~/scratch/data/q40b
// C:              3.1s decode  (approx same vs 32-bit and 64-bit)
// Arith_sh.js     6.7s decode  (32-bit with carries)
// Arith.js      317.0s decode  (64-bit no carries); int64 crippling it.

const IOStream = require("./iostream");
const ByteModel = require("./byte_model");
const RangeCoder = require("./arith_sh");


//----------------------------------------------------------------------
// Main arithmetic entry function: decodes a compressed src and
// returns the uncompressed buffer.

function read_array(src, tab, size) {
    var i = 0; // array value
    var j = 0; // array index: tab[j]
    var last = -1;
    var r2 = 0;

    while (j < size) {
	if (r2) {
	    var run_len = last
	} else {
	    var run_len = 0;
	    var loop = 0;
	    do {
		var r = src.ReadByte()
		if (++loop == 3) {
		    run_len += r*255;
		    r = 255; // FIXME?
		} else {
		    run_len += r;
		}
	    } while (r == 255)
	}

	if (r2 == 0 && run_len == last) {
	    r2 = src.ReadByte();
	} else {
	    if (r2)
		r2--;
	    last = run_len;
	}

	while (run_len && j < size) {
	    run_len--;
	    tab[j++] = i
	}
	
	i++;
    }
}

const QMAX = 256

const FLAG_QMAP   = 1
const FLAG_DEDUP  = 2
const FLAG_FLEN   = 4
const FLAG_STRAND = 8
const FLAG_REV    = 16
const FLAG_PTAB   = 32
const FLAG_DTAB   = 64
const FLAG_QTAB   = 128

function decode_fqz(src, q_len, n_in, n_out) {
    var qtab = new Array(256);
    var ptab = new Array(1024);
    var dtab = new Array(256);
    var stab = new Array(256);
    var qmap = new Array(256);
    
    // Check fqz format version
    var vers = src.ReadByte()
    if (vers != 5) {
	console.log("Invalid FQZComp version number");
	return;
    }

    // Load FQZ parameters
    var flags = src.ReadByte()
    var max_sym = src.ReadByte()
    console.log("flags =", flags, "max_sym =", max_sym)

    var output = new Buffer(n_out);

    var tmp = src.ReadByte()
    var qbits  = tmp>>4
    var qshift = tmp&15
    tmp = src.ReadByte()
    var qloc = tmp>>4
    var sloc = tmp&15
    tmp = src.ReadByte()
    var ploc = tmp>>4
    var dloc = tmp&15

    var params = {
	qbits:    qbits,
	qshift:   qshift,
	qloc:     qloc,

	pbits:    -1, // Why not stored?  In ptab
	pshift:   -1, // Why not stored?  In ptab?
	ploc:     ploc,

	dbits:    -1, // In dtab?
	dshift:   -1, // In dtab?
	dloc:     dloc,

	sloc:     sloc,

	max_sym:  max_sym,
	nsym:     -1,

	do_qmap:   flags & FLAG_QMAP,
	do_dedup:  flags & FLAG_DEDUP,
	fixed_len: flags & FLAG_FLEN,
	do_strand: flags & FLAG_REV,
	do_rev:    flags & FLAG_DEDUP,
	do_ptab:   flags & FLAG_PTAB,
	do_dtab:   flags & FLAG_DTAB,
	do_qtab:   flags & FLAG_QTAB
    }

    console.log(params)

    // Qual map, eg to "unbin" Illumina qualities
    if (flags & FLAG_QMAP) {
	var max_sym = src.ReadByte() // FIXME: no need to store max_sym above in this case
	for (var i = 0; i < max_sym; i++)
	    qmap[i] = src.ReadByte()
    } else {
	for (var i = 0; i < 256; i++)
	    qmap[i] = i;  // NOP
    }

    // Read tables
    if (qbits > 0) {
	if (flags & FLAG_QTAB) {
	    read_array(src, qtab, 256)
	} else {
	    for (var i = 0; i < 256; i++)
		qtab[i] = i;  // NOP
	}
    }

    if (flags & FLAG_PTAB) {
	read_array(src, ptab, 1024);
    } else {
	for (var i = 0; i < 1024; i++)
	    ptab[i] = 0;
    }

    if (flags & FLAG_DTAB) {
	read_array(src, dtab, 256);
    } else {
	for (var i = 0; i < 256; i++)
	    dtab[i] = 0;
    }

    stab[0] = 0;
    stab[1] = (flags & FLAG_STRAND) ? 1 : 0

    // Speed optimisation to avoid doing this below
//    for (var i = 0; i < 1024; i++)
//	ptab[i] <<= ploc;
//    for (var i = 0; i < 1024; i++)
//	dtab[i] <<= dloc;
//    for (var i = 0; i < 2; i++)
//	stab[i] <<= sloc;

    // Create initial models
    var model_qual = new Array(1<<16)
    for (var i = 0; i < (1<<16); i++)
	model_qual[i] = new ByteModel(max_sym+1) // why +1?
    
    var model_len = new Array(4)
    for (var i = 0; i < (1<<4); i++)
	model_len[i] = new ByteModel(256)

    var model_rev = new ByteModel(2)
    var model_dup = new ByteModel(2)

    // TODO: do_rev

    var rc = new RangeCoder(src);
    rc.RangeStartDecode(src);

    // The main decode loop itself
    var is_read2 = 0;
    var fixed_len = 0;
    var p = 0; // number of bases left in current record.  FIXME: count in other dir?
    var i = 0; // position in output buffer
    while (i < n_out) {
	if (p == 0) {
	    // Reset contexts at the start of each new record
	    if (!fixed_len) {
		var len = model_len[0].ModelDecode(src, rc)
		len |= model_len[1].ModelDecode(src, rc) << 8
		len |= model_len[2].ModelDecode(src, rc) << 16
		len |= model_len[3].ModelDecode(src, rc) << 24
		if (flags & FLAG_FLEN)
		    fixed_len = len
	    } else {
		len = fixed_len
	    }

	    // FIXME: do_rev

	    if (flags & FLAG_STRAND)
		is_read2 = model_strand.ModelDecode(src, rc)

	    if (flags & FLAG_DEDUP) {
		if (model_dup.ModelDecode(src, rc)) {
		    // Duplicate of last line
		    for (var x = 0; x < len; x++)
			output[i+x] = output[i+x-len]
		    i += len
		    p = 0
		    continue
		}
	    }

	    p = len;  // number of remaining bytes in this record
	    var delta = 0;
	    var last = 0;
	    var qlast = 0;
	    var q1 = 0;
	}

	// Decode the current quality
	var Q = model_qual[last].ModelDecode(src, rc)
	//console.log("decode ctx",last,qlast & ((1<<qbits)-1),p,ptab[p],is_read2,stab[is_read2],delta,dtab[delta],"qual",Q,"locs",qloc, ploc, sloc, dloc)
	var q = qmap[Q];
	output[i++] = q;

	// Update context for next quality
	qlast = ((qlast << qshift) + qtab[Q]); // >>> 0
	last = ((qlast & ((1<<qbits)-1)) << qloc); // >>> 0
	last += ptab[Math.min(p--, 1023)] << ploc
	last += stab[is_read2] << sloc
	last += dtab[Math.min(delta, 255)] << dloc
	last = (last & 0xffff); // >>> 0; // coerce to +ve integer

	// Update running delta
	delta += (q1 != q) ? 1 : 0
	q1 = q
    }

    return output;
}

function decode(src) {
    var stream = new IOStream(src);

    var q_len = stream.ReadUint32()
    
    var n_out = stream.ReadUint32();
    stream.ReadUint32();

    var n_in = stream.ReadUint32();
    stream.ReadUint32();

    console.log("q_len",q_len)
    console.log("n_in", n_in)
    console.log("n_out",n_out)

    return decode_fqz(stream, q_len, n_in, n_out);
}
    
//----------------------------------------------------------------------
// FQZComp encoder.

function pick_fqz_params(src, q_lens, qhist) {
    // Scan input to find number of symbols and max symbol
    var nsym = 0
    var max_sym = 0
    for (var i = 0; i < 256; i++)
	qhist[i] = 0;
    for (var i = 0; i < src.length; i++)
	qhist[src[i]]++;
    for (var i = 0; i < 256; i++) {
	if (!qhist[i])
	    continue;
	if (max_sym < i)
	    max_sym = i;
	nsym++;
    }

    console.log("Nsym", nsym)
    console.log("Max_sym", max_sym)
    
    // Default options
    var params = {
	qbits:     10,
	qshift:    5,
	qloc:      0,

	pbits:     7,
	pshift:    0,
	ploc:      10,

	dbits:     2,
	dshift:    0,
	dloc:      14,

	sloc:      15,

	max_sym:   max_sym,
	nsym:      nsym,
	
	do_qmap:   0,
	do_dedup:  0,
	fixed_len: 1,
	do_strand: 0,
	do_rev:    0,
	do_pos:    1,
	do_delta:  1,
	do_qtab:   0
    }

    // Reduced symbol frequencies implies lower qshift and
    // a lookup table to go from qual to Q
    if (nsym <= 16) {
	params.do_qmap = 1 // based on qhist
	if (nsym <= 2)
	    params.qshift = 1
	else if (nsym <= 4)
	    params.qshift = 2
	else if (nsym <= 8)
	    params.qshift = 3
	else
	    params.qshift = 4
    }

    console.log(params)
    return params

    // Example of customized options for 9827 data set (q40b)
    return {qbits:    9,
	    qshift:   5,
	    qloc:     7,

	    pbits:    7,
	    pshift:   0,
	    ploc:     0,

	    dbits:    2,
	    dshift:   0,
	    dloc:    14,

	    sloc:    15,

	    max_sym: 44,
	    nsym:    44,
	    
	    do_qmap:  0,
	    do_dedup: 0,
	    fixed_len: 1,
	    do_strand: 0,
	    do_rev:   0,
	    do_pos:   1,
	    do_delta: 1,
	    do_qtab:  0}
}

function store_array(out, tab, size) {
    var i = 0; // index into tab
    var j = 0; // current value in tab[i]

    var tmp1 = new Array(size*2);
    var sz1 = 0;

    // First level of RLE.  Replace all runs of 'j' values
    // with run-lengths, including zeros for missing values.
    // Eg 0 1 2 2 2 3 3 3 4 4 4 5 5 5 5   7 7
    // to 1 1 3     3     3     4       0 2
    while (i < size) {
	// Length of j^{th} element
	var i_start = i
	while (i < size && tab[i] == j)
	    i++;
	var run_len = i - i_start

	// Encode run length to tmp array
	do {
	    var r = Math.min(255, run_len)
	    tmp1[sz1++] = r
	    run_len -= r
	} while (r == 255)
	j++;
    }

    // Second round of RLE on our tmp array, using a different
    // RLE algorithm.
    // Eg 1 1    3 3  3 4 0 2
    // to 1 1 +0 3 3 +1 4 0 2
    var last = -1
    var tmp2 = new Array(size*2)
    var sz2 = 0
    i = 0  // index into tmp1]
    // k is used size of tmp1[]
    while (i < sz1) {
	var curr = tmp1[i++];
	tmp2[sz2++] = curr
	if (curr == last) {
	    var i_start = i;
	    while (i < sz1 && tmp1[i] == last && i - i_start < 255)
		i++;
	    tmp2[sz2++] = i - i_start;
	} else {
	    last = curr
	}
    }

    // Append 2nd RLE, tmp2, to out.
    out.WriteData(tmp2, sz2)
}

				     

// q_lens is an array of quality lengths per record.
// (If they're all the same, just set one value.)
function encode_fqz_meta_data(out, params, qhist, qtab, ptab, dtab, stab) {
    var dsqr = [
        0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3,
        4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
    ]

    // Store meta-data
    out.WriteByte(5); // FQZ format number
    out.WriteByte((params.do_qtab  <<7) |  // FLAG
		  (params.do_delta <<6) |
		  (params.do_pos   <<5) |
		  (params.do_rev   <<4) |
		  (params.do_strand<<3) |
		  (params.fixed_len<<2) |
		  (params.do_dedup <<1) |
		  (params.do_qmap))
    out.WriteByte(params.max_sym) // FIXME, needed?
    out.WriteByte((params.qbits << 4) | (params.qshift))
    out.WriteByte((params.qloc  << 4) | (params.sloc))
    out.WriteByte((params.ploc  << 4) | (params.dloc))

    if (params.do_qmap) {
	out.WriteByte(params.nsym)
	params.max_sym = params.nsym
	var n = 0;
	for (var i = 0; i < 256; i++) {
	    if (qhist[i]) {
		out.WriteByte(i)
		qhist[i] = n++;
	    }
	}
    } else {
	params.nsym = 255;
	for (var i = 0; i < 256; i++)
	    qhist[i] = i; // NOP
    }

    if (params.qbits > 0) {
	for (var i = 0; i < 256; i++)
	    qtab[i] = i; // NOP for now

	if (params.do_qtab)
	    store_array(out, qtab, 256)
    }

    if (params.pbits > 0) {
	for (var i = 0; i < 1024; i++)
	    ptab[i] = Math.min((1<<params.pbits)-1, i >> params.pshift)

	store_array(out, ptab, 1024)

//	for (var i = 0; i < 1024; i++)
//	    ptab[i] <<= params.ploc // optimisation to avoid this in main loop
    }

    if (params.dbits > 0) {
	for (var i = 0; i < 256; i++)
	    if (dsqr[i] > (1<<params.dbits) - 1)
		dsqr[i] = (1<<params.dbits) - 1
	for (var i = 0; i < 256; i++)
	    dtab[i] = dsqr[Math.min(dsqr.length-1, i >> params.dshift)]

	store_array(out, dtab, 256)

//	for (var i = 0; i < 256; i++)
//	    dtab[i] <<= params.dloc // optimisation to avoid this in main loop
    }

    stab[0] = 0
    stab[1] = params.do_strand ? 1 : 0
//    stab[1] <<= params.sloc

    return out
}

function encode_fqz(out, src, q_lens, params, qhist, qtab, ptab, dtab, stab) {
    //console.log(params)

    var n_in = src.length

    // Create the models
    var model_qual = new Array(1<<16)
    for (var i = 0; i < (1<<16); i++)
	model_qual[i] = new ByteModel(params.max_sym+1)

    var model_len = new Array(4)
    for (var i = 0; i < (1<<4); i++)
	model_len[i] = new ByteModel(256)

    var model_rev = new ByteModel(2)
    var model_dup = new ByteModel(2)

    // TODO: do_rev
    var rc = new RangeCoder(src)

    // The main encoding loop
    var p = 0; // remaining position along current record
    var i = 0; // index in src data
    while (i < n_in) {
	if (p == 0) {
	    // Reset contexts at the statr of each new record
	    if (params.fixed_len) {
		var len = q_lens[0]
		if (i == 0) { // First length
		    console.log("Encode len", len)
		    model_len[0].ModelEncode(out, rc, len       & 0xff)
		    model_len[1].ModelEncode(out, rc, (len>>8)  & 0xff)
		    model_len[2].ModelEncode(out, rc, (len>>16) & 0xff)
		    model_len[3].ModelEncode(out, rc, (len>>24) & 0xff)
		}
	    } else {
		process.exit(1);//FIXME
	    }

	    var is_read2 = 0; // FIXME
	    
	    //if (params.do_strand)
	    //    model_strand.ModelEncode(out, rc, is_read2)

	    if (params.do_dedup)
		process.exit(1) // FIXME

	    p = len
	    var delta = 0
	    var last = 0
	    var qlast = 0
	    var q1 = 0
	}

	// Encode current quality
	var q = src[i++]
	//console.log("encode ctx",last,qlast & (1<<params.qbits)-1,p,ptab[p],is_read2,stab[is_read2],delta,dtab[delta],"qual",q,qhist[q],"locs",params.qloc,params.ploc,params.sloc,params.dloc)
	model_qual[last].ModelEncode(out, rc, qhist[q])

	// Update contexts for next quality
	qlast = (qlast << params.qshift) + qtab[qhist[q]]
	last = (qlast & ((1<<params.qbits)-1)) << params.qloc

	// 46.6-48.6 billion cycles with ifs + "<< params.?loc" shifts
	// 47.3-47.3 billion cycles with ifs
	// 47.1-47.9 billion cycles without ifs
	//if (params.pbits > 0)
	last += ptab[Math.min(p--, 1023)] << params.ploc
	//if (params.do_strand)
	last += stab[is_read2] << params.sloc
	//if (params.dbits > 0)
	last += dtab[Math.min(delta, 255)] << params.dloc
	last = (last & 0xffff)

	// Update running delta
	delta += (q1 != q) ? 1 : 0
	q1 = q
    }

    rc.RangeFinishEncode(out)
    return out.buf.slice(0, out.pos)
}

function encode(src) {
    var qhist = new Array(256)
    var qtab  = new Array(256)
    var ptab  = new Array(1024) 
    var dtab  = new Array(256)
    var stab  = new Array(2)

    //var q_lens = [100] // FIXME
    var q_lens = [151] // FIXME

    var out = new IOStream("", 0, src.length*1.1 + 100); // FIXME: guestimate worst case
    out.WriteUint32(q_lens[0]); // FIXME
    out.WriteUint32(src.length); out.WriteUint32(0); // uncompressed size
    out.WriteUint32(0); out.WriteUint32(0); // compressed size, unused...
    
    var params = pick_fqz_params(src, q_lens, qhist)
    var out = encode_fqz_meta_data(out, params, qhist, qtab, ptab, dtab, stab)
    return encode_fqz(out, src, q_lens, params, qhist, qtab, ptab, dtab, stab)
}

module.exports = { decode, encode }
