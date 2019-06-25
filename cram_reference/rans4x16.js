// rANS 4 x 8-bit interleaved streams.
//
// This is a reference implementation designed to match the
// written specification as closely as possible.  It is *NOT*
// an efficient implementation, but see comments below.
// Differences to the pseudocode include a 'src' argument in some functions,
// where this is implicit in the spec, and explicit zeroing of F array
// when reading frequency tables.  The spec doesn't mention a starting state.
//
// Validated against htslib's C implementation
// (cc -g -o rans -DTEST_MAIN rANS_static.c)

const IOStream = require("./iostream");

//----------------------------------------------------------------------
// rANS primitives itself
//
// RansGet* is decoder side

function RansGetCumulativeFreq(R, bits) {
    return R & ((1<<bits)-1)
}

function RansGetSymbolFromFreq(C, f) {
    // NOTE: Inefficient.
    // In practice we would implement this via a precomputed
    // lookup table C2S[f]; see RansBuildC2S below.
    var s = 0;
    while (f >= C[s+1])
	s++;

    //console.error(f, C, s)

    return s;
}

function RansBuildC2S(C, bits) {
    var max = 1<<bits
    var C2S = new Array(max);
    var s = 0;
    for (var f = 0; f < max; f++) {
	while (f >= C[s+1])
	    s++;
	C2S[f] = s;
    }
    return C2S;
}

function RansAdvanceStep(R, c, f, bits) {
    return f * (R >> bits) + (R & ((1<<bits)-1)) - c;
}

function RansRenorm(src, R) {
    if (R < (1<<15))
	R = (R << 16) + src.ReadUint16();

    return R;
}


// RanEnc* is for encoder
function RansEncInit() {
    return 1<<15;
}

function RansEncFlush(R, dst) {
    dst.WriteByteNeg((R >> 24) & 0xff);
    dst.WriteByteNeg((R >> 16) & 0xff);
    dst.WriteByteNeg((R >>  8) & 0xff);
    dst.WriteByteNeg((R >>  0) & 0xff);
}

function RansEncRenorm(R, dst, freq, scale_bits) {
    var R_max = (((1 << 15) >> scale_bits) << 16) * freq;

    while (R >= R_max) {
	dst.WriteByteNeg((R>>8) & 0xff);
	dst.WriteByteNeg(R & 0xff);
	R >>= 16;
    }
    return R;
}

// Puts a symbol with frequency freq, cumulative freq start
// and total freq 1<<scale_bits.
//
// Note with static probabilities, /freq and %freq could be
// precomputed via multiplies and shifts.
function RansEncPut(R, dst, start, freq, scale_bits) {
    var scale = 1<<scale_bits;
    R = RansEncRenorm(R, dst, freq, scale_bits);
    R = (Math.floor(R / freq) << scale_bits) + (R % freq) + start;
    return R;
}


//----------------------------------------------------------------------
// Run length encoding
function EncodeRLE(src) {
    // Step 1: find which symbols benefit from RLE
    var L = new Array(256)
    for (var i = 0; i < 256; i++)
	L[i] = 0

    var last = -1
    for (var i = 0; i < src.length; i++) {
	L[src[i]] += src[i] == last ? 1 : -1
	last = src[i]
    }

    var nrle = 0;
    for (var i = 0; i < 256; i++)
	if (L[i] > 0)
	    nrle++

    // Start meta-data as list of symbols to RLE
    var meta = new IOStream("", 0, nrle+1 + src.length)
    meta.WriteByte(nrle)
    for (var i = 0; i < 256; i++)
	if (L[i] > 0)
	    meta.WriteByte(i)

    // Step 2: Now apply RLE itself
    var data = new Buffer.allocUnsafe(src.length)
    var dpos = 0
    for (var i = 0; i < src.length; i++) {
	data[dpos++] = src[i]
	if (L[src[i]] > 0) {
	    last = src[i];
	    var run = 0;
	    while (i+run+1 < src.length && src[i+run+1] == last)
		run++;
	    meta.WriteUint7(run)
	    i += run
	}
    }

    // Compress the meta-data
    var cmeta = RansEncode0(meta.buf.slice(0, meta.pos))
    var hdr = new IOStream("", 0, 16)
    hdr.WriteUint7(meta.pos*2)   // Uncompressed meta-data length + compressed-bit-flag(0)
    hdr.WriteUint7(dpos)         // Length of RLE encoded data
    hdr.WriteUint7(cmeta.length) // Compressed meta-data length
    var meta = Buffer.concat([hdr.buf.slice(0,hdr.pos), cmeta])

    return [meta, data.slice(0, dpos)]
}

function DecodeRLEMeta(src) {
    var u_meta_len = src.ReadUint7()
    var rle_len = src.ReadUint7()

    // Decode RLE lengths
    if (u_meta_len & 1) {
	var rle_meta = src.ReadData(u_meta_len/2)
    } else {
	var comp_meta_len = src.ReadUint7()
	var rle_meta = src.ReadData(comp_meta_len)
	rle_meta = RansDecode0(new IOStream(rle_meta), u_meta_len/2)
    }

    // Decode list of symbols for which RLE lengths are applied
    var rle_meta = new IOStream(rle_meta)
    var L = new Array(256)
    var n = rle_meta.ReadByte()
    if (n == 0)
	n = 256;
    for (var i = 0; i < n; i++)
	L[rle_meta.ReadByte()] = 1

    return [L, rle_meta, rle_len]
}

function DecodeRLE(buf, L, rle_meta, len) {
    var src = new IOStream(buf);

    var out = new Buffer.allocUnsafe(len)

    // Expand up buf+meta to out; i = buf index, j = out index
    var j = 0;
    for (var i = 0; j < len; i++) {
	var sym = buf[i];
	if (L[sym]) {
	    var run = rle_meta.ReadUint7()
	    for (var r = 0; r <= run; r++)
		out[j++] = sym
	} else {
	    out[j++] = sym
	}
    }

    return out
}

//----------------------------------------------------------------------
// Bit packing

function EncodePack(src) {
    // Step 1: identify number of distinct symbols
    var F = new Array(256)
    for (var i = 0; i < 256; i++)
	F[i] = 0

    for (var i = 0; i < src.length; i++)
	F[src[i]]++

    var P = new Array(256)
    var nsym = 0;
    for (var i = 0; i < 256; i++)
	if (F[i] > 0)
	    P[i] = nsym++

    if (nsym > 16) {
	console.error("Too many symbols to pack:",nsym)
	return
    }


    // Pack data
    if (nsym <= 1) {
	// Constant
	var data = new Buffer.allocUnsafe(0)
    }

    else if (nsym <= 2) {
	// 1 bit per value
	var data = new Buffer.allocUnsafe(Math.ceil(src.length/8))
	var j = -1
	for (i = 0; i < src.length; i++) {
	    if (i % 8 == 0)
		data[++j] = 0
	    data[j] += P[src[i]] << (i % 8)
	}
    }

    else if (nsym <= 4) {
	// 2 bits per value
	var data = new Buffer.allocUnsafe(Math.ceil(src.length/4))
	var j = -1
	for (i = 0; i < src.length; i++) {
	    if (i % 4 == 0)
		data[++j] = 0
	    data[j] += P[src[i]] << ((i % 4) * 2)
	}
    }

    else {
	// 4 bits per value
	var data = new Buffer.allocUnsafe(Math.ceil(src.length/2))
	var j = -1
	for (i = 0; i < src.length; i++) {
	    if (i % 2 == 0)
		data[++j] = 0
	    data[j] += P[src[i]] << ((i % 2) * 4)
	}
    }


    // Produce pack meta-data
    var meta = new IOStream("", 0, nsym+5)
    meta.WriteByte(nsym)
    var j = 0
    for (var i = 0; i < 256; i++) {
	if (F[i] > 0) {
	    F[i] = j++;
	    meta.WriteByte(i)
	}
    }
    meta.WriteUint7(data.length)

    return [meta.buf.slice(0, meta.pos), data]
}


// Pack meta data is the number and value of distinct symbols plus
// the length of the packed byte stream.
function DecodePackMeta(src) {
    var nsym = src.ReadByte()
    var P = new Array(nsym)

    for (var i = 0; i < nsym; i++)
	P[i] = src.ReadByte()

    var len = src.ReadUint7()

    return [P, nsym, len]
}

// Extract bits from src producing output of length len.
// Nsym is number of distinct symbols used.
function DecodePack(data, P, nsym, len) {
    var out = new Buffer.allocUnsafe(len)
    var j = 0;

    // Constant value
    if (nsym <= 1) {
	for (var i = 0; i < len; i++)
	    out[i] = P[0]
    }

    // 1 bit per value
    else if (nsym <= 2) {
	for (i = 0; i < len; i++) {
	    if (i % 8 == 0)
		var v = data[j++];

	    out[i] = P[v & 1]
	    v >>= 1
	}
    }

    // 2 bits per value
    else if (nsym <= 4) {
	for (i = 0; i < len; i++) {
	    if (i % 4 == 0)
		var v = data[j++];

	    out[i] = P[v & 3]
	    v >>= 2
	}
    }

    // 4 bits per value
    else if (nsym <= 16) {
	for (i = 0; i < len; i++) {
	    if (i % 2 == 0)
		var v = data[j++];

	    out[i] = P[v & 15]
	    v >>= 4
	}
    }

    return out
}


//----------------------------------------------------------------------
// 4 way interleaving.
// This is simply 4 rANS streams interleaved to form bytes 0,4,8...,
// 1,5,9..., 2,6,10... and 3,7,11...
//
// It works well when the distributions differ for each of the 4 bytes,
// for example when compressing a series of 32-bit integers.
//
// Maybe make this more general purpose of X* where we specify the stripe
// size instead of fixing it at 4?
function RansEncodeX4(hdr, src) {
    var stride = 4
    if (src.length % stride != 0) {
	console.error("Input data is not a size multiple of", stride)
	return
    }

    // Split into multiple streams
    var ulen = src.length / stride
    var j = 0
    var part = new Array(stride)
    for (var s = 0; s < stride; s++)
	part[s] = new Array(ulen)
    for (var i = 0; i < src.length; i+=stride) {
	for (var s = 0; s < stride; s++)
	    part[s][j] = src[i+s]
	j++
    }

    // Compress each part
    var comp = new Array(stride)
    var total = 0
    for (var s = 0; s < stride; s++) {
	// Example: try O0 and O1 and choose best
	var comp0 = encode(part[s], 0)
	var comp1 = encode(part[s], 1)
	comp[s] = (comp1.length < comp0.length) ? comp1 : comp0
	total += comp[s].length
    }

    // Serialise
    var out = new IOStream("", 0, total+5*stride)
    for (var s = 0; s < stride; s++)
	out.WriteUint7(comp[s].length)

    for (var s = 0; s < stride; s++)
	out.WriteData(comp[s], comp[s].length)

    return out.buf.slice(0, out.buf.pos)
}

function RansDecodeX4(src, len) {
    var clen = new Array(4)
    for (i = 0; i < 4; i++)
	clen[i] = src.ReadUint7()

    var X0 = RansDecodeStream(src, (len/4)>>0)
    var X1 = RansDecodeStream(src, (len/4)>>0)
    var X2 = RansDecodeStream(src, (len/4)>>0)
    var X3 = RansDecodeStream(src, (len/4)>>0)

    var out = new Buffer.allocUnsafe(len)
    var i = 0
    for (var j = 0; j < len/4; j++) {
	out[i+0] = X0[j];
	out[i+1] = X1[j];
	out[i+2] = X2[j];
	out[i+3] = X3[j];
	i += 4;
    }

    return out;
}


//----------------------------------------------------------------------
// Main rANS entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src) {
    var stream = new IOStream(src)
    return RansDecodeStream(stream, 0)
}

function RansDecodeStream(stream, n_out) {
    var format = stream.ReadByte();
    var order  = format & 1
    var x4     = format & 8
    var nosz   = format & 16
    var cat    = format & 32
    var rle    = format & 64
    var pack   = format & 128

    if (!nosz)
	n_out = stream.ReadUint7();

    // 4 way interleaving
    if (x4)
	return RansDecodeX4(stream, n_out)

    // Bit packing
    if (pack) {
	var pack_len = n_out
	var [P, nsym, n_out] = DecodePackMeta(stream)
    }

    // Run length encoding
    if (rle) {
	var rle_len = n_out
	var [L, rle_meta, n_out] = DecodeRLEMeta(stream)
    }

    // Uncompress data (all, packed or run literals)
    if (cat)
	var buf = stream.ReadData(n_out)
    else if (order == 0)
	var buf = RansDecode0(stream, n_out)
    else
	var buf = RansDecode1(stream, n_out)

    // Apply expansion transforms
    if (rle)
	buf = DecodeRLE(buf, L, rle_meta, rle_len)

    if (pack)
	buf = DecodePack(buf, P, nsym, pack_len)

    return buf
}

function encode(src, format) {
    var hdr = new IOStream("", 0, 10);
    hdr.WriteByte(format);

    var order = format & 1
    var x4    = format & 8
    var nosz  = format & 16
    var cat   = format & 32
    var rle   = format & 64
    var pack  = format & 128

    if (!nosz)
	hdr.WriteUint7(src.length);

    if (x4)
	return Buffer.concat([hdr.buf.slice(0, hdr.pos), RansEncodeX4(hdr, src)])

    var pack_meta = new Buffer.alloc(0)
    if (pack)
	[pack_meta, src] = EncodePack(src)

    var rle_meta = new Buffer.alloc(0)
    if (rle)
	[rle_meta, src] = EncodeRLE(src)

    if (cat)
	var comp = src
    else if (order == 0)
	var comp = RansEncode0(src)
    else
	var comp = RansEncode1(src)

    return Buffer.concat([hdr.buf.slice(0,hdr.pos), pack_meta, rle_meta, comp])
}

//----------------------------------------------------------------------
// Order-0 decoder

function ReadAlphabet(src) {
    var A = new Array(256)
    for (var i = 0; i < 256; i++)
	A[i] = 0;

    var rle = 0
    var sym = src.ReadByte()
    var last_sym = sym

    do {
	A[sym] = 1;
	if (rle > 0) {
	    rle--
	    sym++
	} else {
	    sym = src.ReadByte()
	    if (sym == last_sym+1)
		rle = src.ReadByte()
	}
	last_sym = sym
    } while (sym != 0)

    return A
}

// Decode a single table of order-0 frequences,
// filling out the F and C arrays.
function ReadFrequencies0(src, F, C) {
    // Initialise; not in the specification - implicit?
    for (var i = 0; i < 256; i++)
	F[i] = 0;

    // Fetch alphabet
    var A = ReadAlphabet(src);

    // Fetch frequencies for the symbols listed in our alphabet
    for (var i = 0; i < 256; i++) {
	if (A[i] > 0)
	    F[i] = src.ReadUint7()
    }

    NormaliseFrequencies0_Shift(F, 12)

    // Compute C[] from F[]
    C[0] = 0;
    for (var i = 0; i <= 255; i++)
	C[i+1] = C[i] + F[i];
}

function RansDecode0(src, nbytes) {
    // Decode frequencies
    var F = new Array(256);
    var C = new Array(256);
    ReadFrequencies0(src, F, C);

    // Fast lookup to avoid slow RansGetSymbolFromFreq
    var C2S = RansBuildC2S(C, 12);

    // Initialise rANS state
    var R = new Array(4);
    for (var i = 0; i < 4; i++)
	R[i] = src.ReadUint32();

    // Main decode loop
    var output = new Buffer.allocUnsafe(nbytes);
    for (var i = 0; i < nbytes; i++) {
	var i4 = i%4;
	var f = RansGetCumulativeFreq(R[i4], 12);
	var s = C2S[f]; // Equiv to RansGetSymbolFromFreq(C, f);

	output[i] = s;
	R[i4] = RansAdvanceStep(R[i4], C[s], F[s], 12);
	R[i4] = RansRenorm(src, R[i4]);
    }

    return output;
}

//----------------------------------------------------------------------
// Order-0 encoder

function BuildFrequencies0(src, F) {
    for (var i = 0; i < 256; i++)
	F[i] = 0;

    for (var i = 0; i < src.length; i++)
	F[src[i]]++;
}

function NormaliseFrequencies0(F, bits) {
    // Compute total
    var tot = 0;
    for (var i = 0; i < 256; i++)
	tot += F[i];

    // Scale total of frequencies to max
    const max = (1<<bits);
    var scale = max / tot;
    do {
	var max_val = 0;
	var max_idx = 0;
	var renorm = 0;
	tot = 0;
	for (var i = 0; i < 256; i++) {
	    if (F[i] == 0)
		continue

	    if (max_val < F[i]) {
		max_val = F[i]
		max_idx = i
	    }

	    F[i] = Math.floor(F[i] * scale);
	    if (F[i] == 0)
		F[i] = 1;

	    tot += F[i];
	}

	// Adjust new tot to ensure it matches.
	if (tot < max) {
	    // Too low, boost the most common symbol
	    F[max_idx] += max-tot;
	} else if (tot-max < F[max_idx]/2 && F[max_idx] > 2) {
	    // Too high, reduce the common symbol
	    F[max_idx] -= tot-max;
	} else if (tot != max) {
	    // Much too high, fudge scale and try again.
	    scale = scale * 0.99
	    renorm = 1;
	}
    } while (renorm)
}

function NormaliseFrequencies0_Shift(F, bits) {
    // Compute total and number of bits to shift by
    var tot = 0;
    for (var i = 0; i < 256; i++)
	tot += F[i];

    if (tot == 0 || tot == (1<<bits))
	return

    var shift = 0;
    while (tot < (1<<bits)) {
	tot *= 2;
	shift++;
    }

    // Scale total of frequencies to (1<<bits)
    for (var i = 0; i < 256; i++)
	F[i] <<= shift;
}

function WriteAlphabet(out, F) {
    var rle = 0;
    for (var i = 0; i < 256; i++) {
	if (!F[i])
	    continue

	if (rle > 0)
	    rle--
	else {
	    out.WriteByte(i)

	    if (i > 0 && F[i-1] > 0) {
		// We've encoded two symbol frequencies in a row.
		// How many more are there?  Store that count so
		// we can avoid writing consecutive symbols.
		for (rle = i+1; rle<256 && F[rle]; rle++)
		    ;
		rle -= i+1;

		out.WriteByte(rle);
	    }
	}
    }
    out.WriteByte(0)
}

function WriteFrequencies0(out, F) {
    WriteAlphabet(out, F)

    for (var i = 0; i < 256; i++) {
	if (F[i])
	    out.WriteUint7(F[i])
    }
}

function RansEncode0(src) {
    const nbytes = src.length;
    var output = new IOStream("", 0, 257*3+9);

    // Compute frequencies
    var F = new Array(256)
    BuildFrequencies0(src, F)
    var bit_size = Math.ceil(Math.log2(nbytes));
    if (bit_size > 12)
	bit_size = 12;
    NormaliseFrequencies0(F, bit_size);
    WriteFrequencies0(output, F);
    NormaliseFrequencies0(F, 12);

    // Compute cumulative frequencies
    var C = new Array(256)
    C[0] = 0;
    for (var i = 1; i < 256; i++)
	C[i] = C[i-1] + F[i-1];

    // Initialise rANS state
    var R = new Array(4);
    for (var i = 0; i < 4; i++)
	R[i] = RansEncInit();

    // Allow expansion room if trying to compress random data.
    var rans_out = new IOStream("", (nbytes*1.05+100)>>0, (nbytes*1.05+100)>>0);

    // Main encode loop
    for (var i = nbytes-1; i >= 0; i--)
	R[i%4] = RansEncPut(R[i%4], rans_out, C[src[i]], F[src[i]], 12);

    for (var i = 3; i >= 0; i--)
	RansEncFlush(R[i], rans_out);

    // Stitch blocks together into final output buffer
    //console.error("pos=",rans_out.pos, " len=",rans_out.length)
    //console.error(rans_out.buf.slice(rans_out.pos, rans_out.length))
    return Buffer.concat([output.buf.slice(0, output.pos),
			  rans_out.buf.slice(rans_out.pos, rans_out.length)],
			 output.pos + rans_out.length - rans_out.pos);
}

//----------------------------------------------------------------------
// Order-1 decoder

// Decode a table of order-1 frequences,
// filling out the F and C arrays.
function ReadFrequencies1(src, F, C) {
    // Initialise; not in the specification - implicit?
    for (var i = 0; i < 256; i++) {
	F[i] = new Array(256);
	C[i] = new Array(256);
	for (var j = 0; j < 256; j++)
	    F[i][j] = 0;
    }

    // Fetch alphabet
    var A = ReadAlphabet(src);

    // Read F[]
    for (var i = 0; i < 256; i++) {
	if (!A[i])
	    continue

	var run = 0;
	for (var j = 0; j < 256; j++) {
	    if (!A[j])
		continue

	    if (run > 0) {
		run--
	    } else {
		F[i][j] = src.ReadUint7();
		if (F[i][j] == 0)
		    run = src.ReadByte();
	    }
	}

	NormaliseFrequencies0_Shift(F[i], 10)

	// Compute C[] from F[]
	C[i][0] = 0;
	for (var j = 0; j < 256; j++)
	    C[i][j+1] = C[i][j] + F[i][j];
    }
}

function RansDecode1(src, nbytes) {
    // FIXME: this bit is missing from the RansDecode0 pseudocode.

    var comp = src.ReadByte(); // FIXME: discard compressed vs uncompressed header
    var freq_src = src
    if (comp) {
	var ulen = src.ReadUint7()
	var clen = src.ReadUint7()
	var comp = new IOStream(src.ReadData(clen))
	var freq_src = new IOStream(RansDecode0(comp, ulen));
    }

    // Decode frequencies
    var F = new Array(256);
    var C = new Array(256);
    ReadFrequencies1(freq_src, F, C);

    // Fast lookup to avoid slow RansGetSymbolFromFreq
    var C2S = new Array(256);
    for (var i = 0; i < 256; i++)
	// Could do only for symbols in alphabet?
	C2S[i] = RansBuildC2S(C[i], 10);

    // Initialise rANS state
    var R = new Array(4);
    var L = new Array(4);
    for (var j = 0; j < 4; j++) {
	R[j] = src.ReadUint32();
	L[j] = 0;
    }

    // Main decode loop
    var output = new Buffer.allocUnsafe(nbytes);
    var nbytes4 = Math.floor(nbytes/4);
    for (var i = 0; i < nbytes4; i++) {
	for (var j = 0; j < 4; j++) {
	    var f = RansGetCumulativeFreq(R[j], 10);

	    //var s = RansGetSymbolFromFreq(C[L[j]], f);
	    var s = C2S[L[j]][f]; // Precomputed version of above

	    output[i+j*nbytes4] = s;
	    R[j] = RansAdvanceStep(R[j], C[L[j]][s], F[L[j]][s], 10);
	    R[j] = RansRenorm(src, R[j]);
	    L[j] = s;
	}
    }

    // Now deal with the remainder if buffer size is not a multiple of 4,
    // using rANS state 3 exclusively.  (It'd have been nice to have
    // designed this to just act as if we kept going with a bail out.)
    i = 4*i;
    while (i < nbytes) {
	var f = RansGetCumulativeFreq(R[3], 10);
	var s = RansGetSymbolFromFreq(C[L[3]], f);
	output[i++] = s;
	R[3] = RansAdvanceStep(R[3], C[L[3]][s], F[L[3]][s], 10);
	R[3] = RansRenorm(src, R[3]);
	L[3] = s;
    }

    return output;
}

//----------------------------------------------------------------------
// Order-1 encoder

function BuildFrequencies1(src, F, F0) {
    for (var i = 0; i < 256; i++) {
	F0[i] = 0;
	for (var j = 0; j < 256; j++)
	    F[i][j] = 0;
    }

    var last = 0;
    for (var i = 0; i < src.length; i++) {
	F0[last]++;
	F[last][src[i]]++;
	last = src[i];
    }

    // Also accept we'll be starting at 4 points, not just byte 0
    F[0][src[1*(src.length >> 2)]]++;
    F[0][src[2*(src.length >> 2)]]++;
    F[0][src[3*(src.length >> 2)]]++;
    F0[0] += 3;
}

function NormaliseFrequencies1(F, F0) {

    for (var i = 0; i < 256; i++) {
	if (!F0[i])
	    continue;

	var bit_size = Math.ceil(Math.log2(F0[i]));
	if (bit_size > 10)
	    bit_size = 10;

	NormaliseFrequencies0(F[i], bit_size)
    }
}

function NormaliseFrequencies1_Shift(F, F0) {
    for (var i = 0; i < 256; i++)
	if (F0[i])
	    NormaliseFrequencies0_Shift(F[i], 10)
}

function WriteFrequencies1(out, F, F0) {
    WriteAlphabet(out, F0)

    for (var i = 0; i < 256; i++) {
	if (!F0[i])
	    continue

	var run = 0
	for (var j = 0; j < 256; j++) {
	    if (!F0[j])
		continue

	    if (run) {
		run--
	    } else {
		out.WriteUint7(F[i][j])

		if (!F[i][j]) {
		    // Count how many more zero-freqs we have
		    for (var k = j+1; k < 256; k++) {
			if (!F0[k])
			    continue

			if (F[i][k] == 0)
			    run++
			else
			    break
		    }
		    out.WriteByte(run)
		}
	    }
	}
    }
}

function RansEncode1(src) {
    const nbytes = src.length;
    var output = new IOStream("", 0, 257*257*3+9);

    // Compute frequencies
    var F0 = new Array(256)
    var F = new Array(256)
    var C = new Array(256)
    for (var i = 0; i < 256; i++) {
	F[i] = new Array(256);
	C[i] = new Array(256);
    }

    BuildFrequencies1(src, F, F0)
    NormaliseFrequencies1(F, F0);


    // Store frequencies, possibly compressed
    var freq = new IOStream("", 0, 257*257*3+9);

    WriteFrequencies1(freq, F, F0);
    var cfreq = RansEncode0(freq.buf.slice(0, freq.pos))
    if (cfreq.length < freq.pos) {
	output.WriteByte(1);
	output.WriteUint7(freq.pos)
	output.WriteUint7(cfreq.length)
	output.WriteData(cfreq, cfreq.length);
    } else {
	output.WriteByte(0);
	output.WriteData(freq.buf, freq.pos);
    }

    // Normalise and compute cumulative frequencies
    NormaliseFrequencies1_Shift(F, F0);
    for (var i = 0; i < 256; i++) {
	if (!F0[i])
	    continue;

	C[i][0] = 0;
	for (var j = 1; j < 256; j++)
	    C[i][j] = C[i][j-1] + F[i][j-1];
    }

    // Initialise rANS state
    var R = new Array(4);
    var L = new Array(4);
    for (var j = 0; j < 4; j++) {
	R[j] = RansEncInit();
	L[j] = 0;
    }
    var rans_out = new IOStream("", nbytes, nbytes);

    // We have 4 rans codecs running in parallel on its own 1/4tr of buffer
    var nbytes4 = Math.floor(nbytes/4);
    var idx = new Array(4);
    var last = new Array(4)
    for (var j = 0; j < 4; j++) {
	idx[j] = (j+1)*nbytes4 - 2;
	last[j] = src[idx[j]+1]
    }

    // Deal with the remainder if not a multiple of 4
    last[3] = src[nbytes-1];
    for (var i = nbytes-2; i > 4*nbytes4-2; i--) {
	R[3] = RansEncPut(R[3], rans_out, C[src[i]][last[3]], F[src[i]][last[3]], 10);
	last[3] = src[i];
    }

    // Main encode loop
    while (idx[0] >= 0) {
	for (var j = 3; j >= 0; j--) {
	    var s = src[idx[j]]
	    R[j] = RansEncPut(R[j], rans_out, C[s][last[j]], F[s][last[j]], 10);
	    last[j] = s;
	    idx[j]--;
	}
    }

    for (var j = 3; j >= 0; j--) {
        R[j] = RansEncPut(R[j], rans_out, C[0][last[j]], F[0][last[j]], 10)
    }

    for (var i = 3; i >= 0; i--)
	RansEncFlush(R[i], rans_out);

    // Stitch blocks together into final output buffer
    return Buffer.concat([output.buf.slice(0, output.pos),
			  rans_out.buf.slice(rans_out.pos, rans_out.length)],
			 output.pos + rans_out.length - rans_out.pos);
}

module.exports = { decode, encode }
