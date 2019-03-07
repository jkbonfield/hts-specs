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

const FLAG_REV    = 1
const FLAG_DEDUP  = 2
const FLAG_FLEN   = 4
const FLAG_SEL    = 8    // whether selector is used in context
const FLAG_QMAP   = 16
const FLAG_PTAB   = 32
const FLAG_DTAB   = 64
const FLAG_QTAB   = 128

const GFLAG_MULTI_PARAM = 1
const GFLAG_HAVE_STAB   = 2

function decode_fqz(src, q_lens, n_out) {
    // Check fqz format version
    var vers = src.ReadByte()
    if (vers != 5) {
	console.log("Invalid FQZComp version number");
	return;
    }

    var gflags = src.ReadByte()
    var nparam = (gflags & GFLAG_MULTI_PARAM) ? src.ReadByte() : 1
    var n_sel = nparam > 1 ? nparam : 0; // single parameter => no selector
    var stab = new Array(256);
    if (gflags & GFLAG_HAVE_STAB) {
	n_sel = src.ReadByte()
	read_array(src, stab, 256);
    } else {
	for (var i = 0; i < nparam; i++)
	    stab[i] = i;
	for (; i < 256; i++)
	    stab[i] = nparam-1;
    }

    var qtab = new Array(nparam);
    var ptab = new Array(nparam);
    var dtab = new Array(nparam);
    var qmap = new Array(nparam);
    var params = new Array(nparam);

    var global_max_sym = 0;
    for (var p = 0; p < nparam; p++) {
	console.log("file pos =", src.pos)
	qtab[p] = new Array(256);
	ptab[p] = new Array(1024);
	dtab[p] = new Array(256);
	qmap[p] = new Array(256);

	// Load FQZ parameters
	var context = src.ReadUint16()
	var pflags  = src.ReadByte()
	var max_sym = src.ReadByte()
	if (global_max_sym < max_sym)
	    global_max_sym = max_sym; // FIXME: should take outside of param block

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

	params[p] = {
	    qbits:    qbits,
	    qshift:   qshift,
	    qloc:     qloc,

	    pbits:    -1, // Why not stored?  In ptab
	    pshift:   -1, // Why not stored?  In ptab?
	    ploc:     ploc,

	    dbits:    -1, // In dtab?
	    dshift:   -1, // In dtab?
	    dloc:     dloc,

	    sbits:    -1,
	    sloc:     sloc,

	    context:  context,

	    max_sym:  max_sym,
	    nsym:     -1,

	    do_rev:    pflags & FLAG_REV,
	    do_dedup:  pflags & FLAG_DEDUP,
	    fixed_len: pflags & FLAG_FLEN,
	    do_sel:    pflags & FLAG_SEL,
	    do_qmap:   pflags & FLAG_QMAP,
	    do_pos:    pflags & FLAG_PTAB,
	    do_delta:  pflags & FLAG_DTAB,
	    do_qtab:   pflags & FLAG_QTAB

	    // FIXME: add qmap, qtab, ptab, stab and dtab into here too
	}

	console.log(params[p])

	// Qual map, eg to "unbin" Illumina qualities
	if (pflags & FLAG_QMAP) {
	    for (var i = 0; i < max_sym; i++)
		qmap[p][i] = src.ReadByte()
	} else {
	    for (var i = 0; i < 256; i++)
		qmap[p][i] = i;  // NOP
	}

	// Read tables
	if (qbits > 0) {
	    if (pflags & FLAG_QTAB) {
		read_array(src, qtab[p], 256)
	    } else {
		for (var i = 0; i < 256; i++)
		    qtab[p][i] = i;  // NOP
	    }
	}

	if (pflags & FLAG_PTAB) {
	    read_array(src, ptab[p], 1024);
	} else {
	    for (var i = 0; i < 1024; i++)
		ptab[p][i] = 0;
	}

	if (pflags & FLAG_DTAB) {
	    read_array(src, dtab[p], 256);
	} else {
	    for (var i = 0; i < 256; i++)
		dtab[p][i] = 0;
	}
    }

    // Create initial models
    var model_qual = new Array(1<<16)
    for (var i = 0; i < (1<<16); i++)
	model_qual[i] = new ByteModel(global_max_sym+1) // why +1?
    
    var model_len = new Array(4)
    for (var i = 0; i < (1<<4); i++)
	model_len[i] = new ByteModel(256)

    var model_rev   = new ByteModel(2)
    var model_dup   = new ByteModel(2)

    if (n_sel > 0)
	var model_sel = new ByteModel(n_sel)

    // TODO: do_rev

    var rc = new RangeCoder(src);
    rc.RangeStartDecode(src);

    // The main decode loop itself
    var s = 0; // param selector
    var p = 0 // number of bases left in current record.  FIXME: count in other dir?
    var i = 0; // position in output buffer
    while (i < n_out) {
	if (p == 0) {
	    // Param selector
	    if (n_sel > 0) {
		s = model_sel.ModelDecode(src, rc)
		//console.log("Sel", s)
	    } else {
		s = 0;
	    }
	    x = stab[s]
	    // Reset contexts at the start of each new record
	    if (params[x].fixed_len >= 0) {
		// Not fixed or fixed but first record
		var len = model_len[0].ModelDecode(src, rc)
		len |= model_len[1].ModelDecode(src, rc) << 8
		len |= model_len[2].ModelDecode(src, rc) << 16
		len |= model_len[3].ModelDecode(src, rc) << 24
		//console.log("Len", len)
		if (params[x].fixed_len > 0)
		    params[x].fixed_len = -len
	    } else {
		len = -params[x].fixed_len
		//console.log("reuse len", s, len)
	    }
	    q_lens.push(len)

	    // FIXME: do_rev

	    if (params[x].pflags & FLAG_DEDUP) {
		console.log("decode dup")
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
	    var last  = 0;
	    var qlast = 0;
	    var q1    = 0;
	}

	// Decode the current quality
	var Q = model_qual[last].ModelDecode(src, rc)
	//console.log("Ctx",last,Q)
	var q = qmap[x][Q];
	output[i++] = q;

	// Update context for next quality
	qlast = ((qlast << params[x].qshift) + qtab[x][Q]); // >>> 0
	last  = params[x].context
	last += ((qlast & ((1<<params[x].qbits)-1)) << params[x].qloc); // >>> 0

	if (params[x].do_pos)
	    last += ptab[x][Math.min(p, 1023)] << params[x].ploc

	if (params[x].do_delta) {
	    last += dtab[x][Math.min(delta, 255)] << params[x].dloc
	    delta += (q1 != q) ? 1 : 0
	    q1 = q
	}

	if (params[x].do_sel)
	    last += s << params[x].sloc

	last = (last & 0xffff); // >>> 0; // coerce to +ve integer
	p--
    }

    return output;
}

function decode(src, q_lens) {
    var stream = new IOStream(src);

    var n_out = stream.ReadUint32(); stream.ReadUint32();

    //console.log("q_len",q_len)
    //console.log("n_in", n_in)
    console.log("n_out",n_out)

    return decode_fqz(stream, q_lens, n_out);
}
    
//----------------------------------------------------------------------
// FQZComp encoder.

function pick_fqz_params(src, q_lens, q_dirs, qhist) {
    // Find cardinality of q_dirs
    var qd_last = q_dirs[0];
    for (var i = 0; i < q_dirs.length; i++)
	if (q_dirs[i] != qd_last)
	    break;
    var qd_fixed = (i == q_dirs.length) ? 1 : 0

    // Scan input to find number of symbols and max symbol
    var nsym = 0
    var max_sym = 0

    // selector == 0: Assume one single input dataset
    for (var i = 0; i < 256; i++)
	qhist[0][i] = 0;

    var rec = 0;
    var len = 0
    for (var i = 0; i < src.length; i++) {
	if (len == 0) {
	    len = q_lens[rec < q_lens.length-1 ? rec++ : rec]
	}
	qhist[0][src[i]]++;
	len--;
    }
    for (var i = 0; i < 256; i++) {
	if (!qhist[0][i])
	    continue;
	if (max_sym < i)
	    max_sym = i;
	nsym++;
    }

    var qshift = 5
    var do_qmap = 0
    // Reduced symbol frequencies implies lower qshift and
    // a lookup table to go from qual to Q
    if (nsym <= 16) {
	do_qmap = 1 // based on qhist
	if (nsym <= 2)
	    qshift = 1
	else if (nsym <= 4)
	    qshift = 2
	else if (nsym <= 8)
	    qshift = 3
	else
	    qshift = 4
    }

    console.log("Nsym", nsym)
    console.log("Max_sym", max_sym)


//    // Two params and a 1-bit selector.
//    // This is 1% overhead vs two data sets compressed independently.
//    // It's 6.9% smaller than compressing both together with 1 param.
//    if (0) return [{
//	// q4
//	qbits:     8,
//	qshift:    2,
//	qloc:      7,
//
//	pbits:     7,
//	pshift:    1,
//	ploc:      0,
//
//	dbits:     0,
//	dshift:    0,
//	dloc:      0,
//
//      sbits:     0,
//      sloc:      0,
//
//	//sbits:     2,
//	//do_stab:   1,
//	sbits:     1,
//	do_stab:   0,
//	context:   (0<<15),
//
//	max_sym:   36,
//	nsym:      4,
//
//	do_qmap:   1,
//	do_dedup:  0,
//	fixed_len: 1,
//	do_sel:  0,
//	do_rev:    0,
//	do_pos:    1,
//	do_delta:  0,
//	do_qtab:   0
//    }, {
//	//q40
//	qbits:     9,
//	qshift:    5,
//	qloc:      7,
//
//	pbits:     7,
//	pshift:    0,
//	ploc:      0,
//
//	dbits:     0,
//	dshift:    0,
//	dloc:      0,
//
//      sbits:     0,
//      sloc:      0,
//
//	//sbits:     2,
//	//do_stab:   1,
//	sbits:     1,
//	do_stab:   0,
//	context:   (1<<15),
//
//	max_sym:   44,
//	nsym:      45,
//
//	do_qmap:   0,
//	do_dedup:  0,
//	fixed_len: 1,
//	do_sel:  0,
//	do_rev:    0,
//	do_pos:    1,
//	do_delta:  0,
//	do_qtab:   0
//    }]

    return [{qbits:     8+(qshift>4),
	     qshift:    qshift,
	     qloc:      7,

	     pbits:     7,
	     pshift:    q_lens[0] > 128 ? 1 : 0,
	     ploc:      0,

	     dbits:     qshift>4 ? 0 : 1,
	     dshift:    3,
	     dloc:      15,


	     // NB: Also useful as a way of embedding sel and doing sel
	     // specific contexts. Identical bar context. Eg 0<<15 or 1<<15.
	     sbits:     0,
	     sloc:      15,
	     do_stab:   0,
	     context:   (0<<15),

	     max_sym:   max_sym,
	     nsym:      nsym,

	     do_qmap:   do_qmap,
	     do_dedup:  0,
	     fixed_len: (q_lens.length == 1) ? 1 : 0,
	     do_sel:    0,
	     do_rev:    0,
	     do_pos:    1,
	     do_delta:  (qshift <= 4) ? 1 : 0,
	     do_qtab:   0,

	     // Override above with some attempt at using selectors
	     // when the q_dirs are specific and non-fixed.
	     qbits:     8+(qshift>4)-(qd_fixed==0),
	     sbits:     1,
	     sloc:      15-(qshift<=4), // read1 vs read2
	     do_stab:   1,
	     do_sel:    1,
	     
//	     // q4+dir: 7245769 with, 7353962 without. 1.5% saving
//	     qbits:     6,
//	     dbits:     2,
//	     dshift:    2,
//	     dloc:      13,
//	     sbits:     1,
//	     sloc:      15,
//	     do_stab:   1,
//	     do_sel:    1,

	     // with 20 bits of context, q40 = 31741545
	     // qbits 10, dbits 2, pbits 7, sbits 1
	    }]
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
function encode_fqz_params(out, params, qhist, qtab, ptab, dtab, stab) {
    var dsqr = [
        0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3,
        4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
        6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7
    ]

    for (var i = 0; i < params.length; i++)
	stab[i] = i; // 1 parameter set per selector value
    for (; i < 256; i++)
	stab[i] = params.length-1;

    // Store global meta-data
    out.WriteByte(5);            // FQZ format number
    var gflags = ((params.length > 1) ? GFLAG_MULTI_PARAM : 0)
	       | ((params[0].do_stab) ? GFLAG_HAVE_STAB   : 0)
    console.log("gflags",gflags)
    out.WriteByte(gflags)

    if (gflags & GFLAG_MULTI_PARAM)
	out.WriteByte(params.length) // Number of parameter blocks.

    if (gflags & GFLAG_HAVE_STAB) {
	out.WriteByte(1<<params[0].sbits)
	store_array(out, stab, 256)
    }
    console.log("nparam",params.length,"sbits",params[0].sbits)

    // Store per-param meta-data
    for (var p = 0; p < params.length; p++) {
	out.WriteUint16(params[p].context)
	out.WriteByte((params[p].do_qtab  ? FLAG_QTAB  : 0) |  // FLAG
		      (params[p].do_delta ? FLAG_DTAB  : 0) |
		      (params[p].do_pos   ? FLAG_PTAB  : 0) |
		      (params[p].do_qmap  ? FLAG_QMAP  : 0) |
		      (params[p].do_sel   ? FLAG_SEL   : 0) |
		      (params[p].fixed_len? FLAG_FLEN  : 0) |
		      (params[p].do_dedup ? FLAG_DEDUP : 0) |
		      (params[p].do_rev   ? FLAG_REV   : 0))
	if (params[p].do_qmap)
	    out.WriteByte(params[p].nsym)
	else
	    out.WriteByte(params[p].max_sym)
	out.WriteByte((params[p].qbits << 4) | (params[p].qshift))
	out.WriteByte((params[p].qloc  << 4) | (params[p].sloc))
	out.WriteByte((params[p].ploc  << 4) | (params[p].dloc))

	if (params[p].do_qmap) {
	    params[p].max_sym = params[p].nsym
	    var n = 0;
	    for (var i = 0; i < 256; i++) {
		if (qhist[p][i]) {
		    out.WriteByte(i)
		    qhist[p][i] = n++;
		}
	    }
	    // Ensure we have all matched input params
	    for (; n < params[p].nsym; n++)
		out.WriteByte(0)
	} else {
	    //params[p].nsym = 255;
	    for (var i = 0; i < 256; i++)
		qhist[p][i] = i; // NOP
	}

	if (params[p].qbits > 0) {
	    //	// Eg map 0-44 to a smaller range, to improve context usage.
	    //	// Makes q40 test set go from 33596471 to 33450075 (-0.4%)
	    //	params[p].do_qtab = 1;
	    //	for (var j = i = 0; i < params[p].max_sym; i++) {
	    //	    qtab[i]=j;
	    //	    if ((i%3)!=0 | i >= 28) j++
	    //	    console.log("qtab[",i,"]=",qtab[i]);
	    //	}
	    //	for (; i < 256; i++)
	    //	    qtab[i] = qtab[params[p].max_sym-1]

	    for (var i = 0; i < 256; i++)
		qtab[p][i] = i; // NOP for now

	    if (params[p].do_qtab)
		store_array(out, qtab[p], 256)
	}

	if (params[p].pbits > 0) {
	    for (var i = 0; i < 1024; i++)
		ptab[p][i] = Math.min((1<<params[p].pbits)-1, i >> params[p].pshift)

	    store_array(out, ptab[p], 1024)
	}

	if (params[p].dbits > 0) {
	    for (var i = 0; i < 256; i++)
		if (dsqr[i] > (1<<params[p].dbits) - 1)
		    dsqr[i] = (1<<params[p].dbits) - 1
	    for (var i = 0; i < 256; i++)
		dtab[p][i] = dsqr[Math.min(dsqr.length-1, i >> params[p].dshift)]

	    store_array(out, dtab[p], 256)
	}
    }

    return out
}

function encode_fqz(out, src, q_lens, q_dirs, params, qhist, qtab, ptab, dtab, stab) {
    //console.log("0:",params[0])
    //console.log("1:",params[1])

    var n_sel = 1<<params[0].sbits
    var n_in = src.length

    // Create the models
    var max_sym = 0;
    for (var p = 0; p < params.length; p++)
	if (max_sym < params[p].max_sym)
	    max_sym = params[p].max_sym;

    var model_qual = new Array(1<<16)
    for (var i = 0; i < (1<<16); i++)
	model_qual[i] = new ByteModel(max_sym+1)

    var model_len = new Array(4)
    for (var i = 0; i < (1<<4); i++)
	model_len[i] = new ByteModel(256)

    var model_rev    = new ByteModel(2)
    var model_dup    = new ByteModel(2)
    var model_sel    = new ByteModel(n_sel)

    // TODO: do_rev
    var rc = new RangeCoder(src)

    // The main encoding loop
    var p = 0; // remaining position along current record
    var i = 0; // index in src data
    var rec = 0;

//    var delta = new Array(n_sel).fill(0)
//    var last  = new Array(n_sel).fill(0)
//    var qlast = new Array(n_sel).fill(0)
//    var q1    = new Array(n_sel).fill(0)

    while (i < n_in) {
	if (p == 0) {
	    //var s = 0 // single non-mixed sample
	    var s = q_dirs[rec]
	    if (params[0].sbits > 0) {// FIXME: check All params[].do_stab / sbits must be identical
		//console.log("Ssel", s)
	        model_sel.ModelEncode(out, rc, s)
	    }
	    var x = stab[s]

	    // Reset contexts at the statr of each new record
	    var len = q_lens[Math.min(q_lens.length-1, rec++)]
	    if (params[x].fixed_len) {
		if (params[x].fixed_len > 0) { // First length
		    //console.log("Len", len)
		    model_len[0].ModelEncode(out, rc, len       & 0xff)
		    model_len[1].ModelEncode(out, rc, (len>>8)  & 0xff)
		    model_len[2].ModelEncode(out, rc, (len>>16) & 0xff)
		    model_len[3].ModelEncode(out, rc, (len>>24) & 0xff)
		    params[x].fixed_len = -1; // indicate we've stored it once
		}
	    } else {
		//console.log("len", len)
		model_len[0].ModelEncode(out, rc, len       & 0xff)
		model_len[1].ModelEncode(out, rc, (len>>8)  & 0xff)
		model_len[2].ModelEncode(out, rc, (len>>16) & 0xff)
		model_len[3].ModelEncode(out, rc, (len>>24) & 0xff)
	    }

	    if (params[x].do_dedup)
		process.exit(1) // FIXME

	    p = len
	    var delta = 0
	    //var last  = 0
	    var last  = params[x].context
	    var qlast = 0
	    var q1    = 0
	}

	// Encode current quality
	var q = src[i++]
	model_qual[last].ModelEncode(out, rc, qhist[x][q])
	//console.log("Ctx",last,qhist[x][q])

	// Update contexts for next quality
	qlast = (qlast << params[x].qshift) + qtab[x][qhist[x][q]]
	last = (qlast & ((1<<params[x].qbits)-1)) << params[x].qloc

	// 46.6-48.6 billion cycles with ifs + "<< params[x].?loc" shifts
	// 47.3-47.3 billion cycles with ifs
	// 47.1-47.9 billion cycles without ifs
	if (params[x].pbits > 0)
	    last += ptab[x][Math.min(p, 1023)] << params[x].ploc

	if (params[x].dbits > 0) {
	    last += dtab[x][Math.min(delta, 255)] << params[x].dloc
	    delta += (q1 != q) ? 1 : 0
	    q1 = q
	}

	if (params[x].do_sel)
	    last += s << params[x].sloc

	last = (last & 0xffff)
	p--
    }

    rc.RangeFinishEncode(out)
    return out.buf.slice(0, out.pos)
}

function encode(src, q_lens, q_dirs) {
    var qhist = new Array(2)
    var qtab  = new Array(2)
    var ptab  = new Array(2)
    var dtab  = new Array(2)
    var stab  = new Array(256)

    for (var s = 0; s < 2; s++) {
        qhist[s] = new Array(256)
        qtab[s]  = new Array(256)
        ptab[s]  = new Array(1024) 
        dtab[s]  = new Array(256)
    }

    var out = new IOStream("", 0, src.length*1.1 + 100); // FIXME: guestimate worst case
    out.WriteUint32(src.length); out.WriteUint32(0); // uncompressed size
    
    var params = pick_fqz_params(src, q_lens, q_dirs, qhist)
    console.log(params)
    var out = encode_fqz_params(out, params, qhist, qtab, ptab, dtab, stab)
    return encode_fqz(out, src, q_lens, q_dirs, params, qhist, qtab, ptab, dtab, stab)
}

module.exports = { decode, encode }
