// An arithmetic coder, based on Eugene Shelwien's reimplementation of
// Michael Schindler range coder.
//
// Order-0 byte stream of ~/scratch/data/q40b
// C:              3.1s decode  (approx same vs 32-bit and 64-bit)
// Arith_sh.js     6.7s decode  (32-bit with carries)
// Arith.js      317.0s decode  (64-bit no carries); int64 crippling it.

//----------------------------------------------------------------------
// Arithmetic (range) coder
module.exports = class RangeCoder {
    constructor(src) {
	this.low   = 0;
	this.range = 0xffffffff;
	this.code  = 0;
	this.FFnum = 0;
	this.carry = 0;
	this.cache = 0;
    }

    RangeStartDecode(src) {
	for (var i = 0; i < 5; i++)
	    this.code = (this.code << 8) + src.ReadByte();
	this.code &= 0xffffffff;
	this.code >>>= 0; // force to be +ve int
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

	while (this.range < (1<<24)) {
	    this.range *= 256;
	    this.code = (this.code*256 + src.ReadByte());
	}
    }

    RangeShiftLow(dst) {
	if (this.low < 0xff000000 | this.carry) {
	    // cached byte if low < (ff<<24) or
	    // cached byte+1 otherwise
	    dst.WriteByte(this.cache + this.carry);

	    // Flush any stored FFs
	    while (this.FFnum) {
		//console.log("emit carry");
		// a series of ff is low < (ff<<24)
		// or a series of zeros if carry
		dst.WriteByte(this.carry-1);
		this.FFnum--;
	    }
	    // Take a copy of top byte ready for next flush
	    this.cache = this.low >>> 24;
	    this.carry = 0;
	} else {
	    this.FFnum++; // keep track of number of overflows to write
	}
	this.low <<= 8;
	this.low >>>= 0; // force to be +ve int
    }

    RangeEncode(dst, sym_low, sym_freq, tot_freq) {
	var tmp = this.low
	this.range  = Math.floor(this.range / tot_freq)
	this.low   += sym_low * this.range;
	this.low >>>= 0; // force to be +ve int
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
