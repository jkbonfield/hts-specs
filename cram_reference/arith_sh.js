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
	
	// FIXME: move in spec to RangeStartDecode below
	for (var i = 0; i < 5; i++)
	    this.code = (this.code << 8) + src.ReadByte();
	this.code = Math.min(this.code, 0xffffffff);
    }

// Encoder side
//    RangeShiftLow(src) {
//	if (rc->low < 0xff000000 | rc->carry) {
//	    rc->out_buf++ = rc->cache + rc->carry;
//	    while (rc->FFnum) {
//		rc->out_buf++ = rc->carry-1;
//		rc->FFnum--;
//	    }
//	} else {
//	    rc->FFnum++;
//	}
//	rc->low <<= 8;
//    }
    
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
	    //this.code = Math.min(this.code, 0xffffffff);
	}
    }
};

//----------------------------------------------------------------------
// Main arithmetic entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src) {
    return decode0(src);
}

function decode0(src) {
    var stream = new IOStream(src);

    // Punt this bit to main_arith.js
    var n_out = stream.ReadUint32();
    stream.ReadUint32();
    var output = new Buffer(n_out);

    var byte_model = new ByteModel(256);

    var rc = new RangeCoder(stream);
//    RC_StartDecode(&rc);

    for (var i = 0; i < n_out; i++)
	output[i] = byte_model.ModelDecode(stream, rc);

//    RC_FinishDecode(&rc);

    return output;
}

function decode1(src) {
    var stream = new IOStream(src);

    // Punt this bit to main_arith.js
    //var n_out = stream.ReadUint64();
    var n_out = stream.ReadUint32();
    stream.ReadUint32();
    //var output = new Buffer(n_out.toNumber());
    var output = new Buffer(n_out);

    var byte_model = new Array(256);
    for (var i = 0; i < 256; i++)
	byte_model[i] = new ByteModel(256);

    var rc = new RangeCoder(stream);
//    RC_StartDecode(&rc);

    var last = 0;
    for (var i = 0; i < n_out; i++) {
	output[i] = byte_model[last].ModelDecode(stream, rc);
	last = output[i];
    }

//    RC_FinishDecode(&rc);

    return output;
}

module.exports = { RangeCoder, decode }
