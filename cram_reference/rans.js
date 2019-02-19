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
function RansGetCumulativeFreq(R) {
    return R & 0xfff;
}

function RansGetSymbolFromFreq(C, f) {
    // NOTE: Inefficient.
    // In practice we would implement this via a precomputed
    // lookup table C2S[f].
    var s = 0;
    while (f >= C[s+1])
	s++;

    return s;
}

function RansAdvanceStep(R, c, f) {
    return f * (R >> 12) + (R & 0xfff) - c;
}

function RansRenorm(src, R) {
    while (R < (1<<23))
	R = (R << 8) + src.ReadByte();

    return R;
}

//----------------------------------------------------------------------
// Main rANS entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src) {
    var stream = new IOStream(src);
    var order = stream.ReadByte();
    var n_in  = stream.ReadUint32();
    var n_out = stream.ReadUint32();

    if (order == 0) {
	return RansDecode0(stream, n_out)
    } else {
	return RansDecode1(stream, n_out)
    }
}

//----------------------------------------------------------------------
// Order-0 decoder

// Decode a single table of order-0 frequences,
// filling out the F and C arrays.
function ReadFrequencies0(src, F, C) {
    // Initialise; not in the specification - implicit?
    for (var i = 0; i < 256; i++)
	F[i] = 0;

    var sym = src.ReadByte();
    var last_sym = sym;
    var rle = 0;

    // Read F[]
    do {
	var f = src.ReadITF8();
	F[sym] = f;
	if (rle > 0) {
	    rle--;
	    sym++;
	} else {
	    sym = src.ReadByte();
	    if (sym == last_sym+1)
		rle = src.ReadByte();
	}
	last_sym = sym;
    } while (sym != 0);

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

    // Initialise rANS state
    var R = new Array(4);
    for (var i = 0; i < 4; i++)
	R[i] = src.ReadUint32();

    // Main decode loop
    var output = new Buffer(nbytes);
    for (var i = 0; i < nbytes; i+=4) {
	for (var j = 0; j < 4; j++) {
	    if (i+j >= nbytes)
		return output;

	    var f = RansGetCumulativeFreq(R[j]);
	    var s = RansGetSymbolFromFreq(C, f);
	    output[i+j] = s;
	    R[j] = RansAdvanceStep(R[j], C[s], F[s]);
	    R[j] = RansRenorm(src, R[j]);
	}
    }

    return output;
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

    var sym = src.ReadByte();
    var last_sym = sym;
    var rle = 0;

    // Read F[]
    do {
	ReadFrequencies0(src, F[sym], C[sym]);

	if (rle > 0) {
	    rle--;
	    sym++;
	} else {
	    sym = src.ReadByte();
	    if (sym == last_sym+1)
		rle = src.ReadByte();
	}
	last_sym = sym;
    } while (sym != 0);
}

function RansDecode1(src, nbytes) {
    // FIXME: this bit is missing from the RansDecode0 pseudocode.

    // Decode frequencies
    var F = new Array(256);
    var C = new Array(256);
    ReadFrequencies1(src, F, C);

    // Initialise rANS state
    var R = new Array(4);
    var L = new Array(4);
    for (var j = 0; j < 4; j++) {
	R[j] = src.ReadUint32();
	L[j] = 0;
    }

    // Main decode loop
    var output = new Buffer(nbytes);
    var nbytes4 = Math.floor(nbytes/4);
    for (var i = 0; i < nbytes4; i++) {
	for (var j = 0; j < 4; j++) {
	    var f = RansGetCumulativeFreq(R[j]);
	    var s = RansGetSymbolFromFreq(C[L[j]], f);
	    output[i+j*nbytes4] = s;
	    R[j] = RansAdvanceStep(R[j], C[L[j]][s], F[L[j]][s]);
	    R[j] = RansRenorm(src, R[j]);
	    L[j] = s;
	}
    }

    // Now deal with the remainder if buffer size is not a multiple of 4,
    // using rANS state 3 exclusively.  (It'd have been nice to have
    // designed this to just act as if we kept going with a bail out.)
    i = 4*i;
    while (i < nbytes) {
	var f = RansGetCumulativeFreq(R[3]);
	var s = RansGetSymbolFromFreq(C[L[3]], f);
	output[i+3*nbytes4] = s;
	R[3] = RansAdvanceStep(R[3], C[L[3]][s], F[L[3]][s]);
	R[3] = RansRenorm(src, R[3]);
	L[3] = s;
	i++;
    }

    return output;
}

module.exports = { decode }
