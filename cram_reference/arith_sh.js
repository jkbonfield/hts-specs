// An arithmetic coder, based on Eugene Shelwien's reimplementation of
// Michael Schindler range coder.
//
// Order-0 byte stream of ~/scratch/data/q40b
// C:              3.1s decode  (approx same vs 32-bit and 64-bit)
// Arith_sh.js     6.7s decode  (32-bit with carries)
// Arith.js      317.0s decode  (64-bit no carries); int64 crippling it.

const IOStream = require("./iostream");
const ByteModel = require("./byte_model");

//----------------------------------------------------------------------
// Arithmetic (range) coder
class RangeCoder {
    constructor(src) {
	this.low   = 0;
	this.range = 0xffffffff;
	this.code  = 0;
	this.FFnum = 0;
	this.carry = 0;
	this.cache = 0;
    }

    RangeStartDecode(src) {
	// May overflow.  We read in 8 bytes but only max can use last 4.
	// Discard first 4?  Why are they even written?
	for (var i = 0; i < 5; i++)
	    this.code = (this.code << 8) + src.ReadByte();
	this.code = Math.min(this.code, 0xffffffff);
    }

    RangeGetFrequency(tot_freq) {
	this.range = Math.floor(this.range / tot_freq);
	//return this.code / this.range;
	return Math.floor(this.code / this.range);

	// Conceptual scenario; return freq only and don't modify range yet
	//return Math.floor(this.code / (Math.floor(this.range / tot_freq)));
    }

    RangeDecode(src, sym_low, sym_freq, tot_freq) {
	// Conceptually we divide range here, but in practice we cached it earlier
	//this.range = Math.floor(this.range / tot_freq);

	this.code  -= sym_low * this.range;
	this.range *= sym_freq;
	//this.range = Math.min(this.range, 0xffffffff);

	while (this.range < (1<<24)) {
	    this.range *= 256;
	    this.code = (this.code*256 + src.ReadByte());
	}
    }

    RangeShiftLow(dst) {
	if (this.low < 0xff000000 | this.carry) {
	    dst.WriteByte(this.cache + this.carry);

	    // Flush any stored FFs
	    while (this.FFnum) {
		//console.log("emit carry");
		dst.WriteByte(this.carry-1);
		this.FFnum--;
	    }
	    // Take a copy of top byte ready for next flush
	    this.cache = this.low >> 24;
	    this.carry = 0;
	} else {
	    this.FFnum++; // keep track of number of overflows to write
	}
	this.low <<= 8;
	if (this.low < 0)
	    this.low += 4294967296
    }

    RangeEncode(dst, sym_low, sym_freq, tot_freq) {
	var tmp = this.low
	this.range  = Math.floor(this.range / tot_freq)
	this.low   += sym_low * this.range;
	this.low    = this.low & 0xffffffff;
	if (this.low < 0)
	    this.low += 4294967296
	this.range *= sym_freq;

	this.carry += (this.low < tmp) ? 1 : 0; // count overflows
	while (this.range < (1<<24)) {
	    this.range *= 256;
	    this.RangeShiftLow(dst);
	}
    }

    RangeFinishEncode(dst) {
	for (var i = 0; i < 5; i++)
	    this.RangeShiftLow(dst)
    }
};

//----------------------------------------------------------------------
// Main arithmetic entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src, order) {
    return order ? decode1(src) : decode0(src);
}

function encode(src, order) {
    return order ? encode1(src) : encode0(src);
}

//----------------------------------------------------------------------
// Order-0 codec

function decode0(src) {
    var stream = new IOStream(src);

    var n_out = stream.ReadUint32();
    stream.ReadUint32();
    var output = new Buffer(n_out);

    var byte_model = new ByteModel(256);

    var rc = new RangeCoder(stream);
    rc.RangeStartDecode(stream);

    for (var i = 0; i < n_out; i++)
	output[i] = byte_model.ModelDecode(stream, rc);

    return output;
}

function encode0(src) {
    const n_in = src.length
    var out = new IOStream("", 0, n_in*1.1 + 100); // guestimate worst case!

    out.WriteUint32(n_in);
    out.WriteUint32(0);

    var byte_model = new ByteModel(256);
    var rc = new RangeCoder(out);

    for (var i = 0; i < n_in; i++)
	byte_model.ModelEncode(out, rc, src[i])
    rc.RangeFinishEncode(out)

    return out.buf.slice(0, out.pos);
}

//----------------------------------------------------------------------
// Order-1 codec

function decode1(src) {
    var stream = new IOStream(src);

    var n_out = stream.ReadUint32();
    stream.ReadUint32();
    var output = new Buffer(n_out);

    var byte_model = new Array(256);
    for (var i = 0; i < 256; i++)
	byte_model[i] = new ByteModel(256);

    var rc = new RangeCoder(stream);
    rc.RangeStartDecode(stream);

    var last = 0;
    for (var i = 0; i < n_out; i++) {
	output[i] = byte_model[last].ModelDecode(stream, rc);
	last = output[i];
    }

    return output;
}

function encode1(src) {
    const n_in = src.length
    var out = new IOStream("", 0, n_in*1.1 + 100); // guestimate worst case!

    out.WriteUint32(n_in);
    out.WriteUint32(0);

    var byte_model = new Array(256);
    for (var i = 0; i < 256; i++)
	byte_model[i] = new ByteModel(256);
    var rc = new RangeCoder(out);

    var last = 0;
    for (var i = 0; i < n_in; i++) {
	byte_model[last].ModelEncode(out, rc, src[i])
	last = src[i]
    }
    rc.RangeFinishEncode(out)

    return out.buf.slice(0, out.pos);
}

module.exports = { RangeCoder, decode, encode }
