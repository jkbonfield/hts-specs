// An adaptive probability model for encoding and decoding of symbols
// within a given alphabet, using the range coder to get/put the
// compressed data.

const MAX_FREQ = ((1<<16)-16)
const STEP     = 8

module.exports = class ByteModel {
    constructor(max_sym = 256) {
	this.total_freq = max_sym;
	this.max_sym = max_sym-1;
	this.S = new Array
	this.F = new Array

	for (var i = 0; i <= this.max_sym; i++) {
	    this.S[i] = i;
	    this.F[i] = 1;
	}
    }

    ModelDecode(src, rc) {
	// Find symbol
	var freq = rc.RangeGetFrequency(this.total_freq);

	// Linear scan to find cumulative frequency 'freq'
	var acc = 0;
	var x = 0;
	while (acc + this.F[x] <= freq)
	    acc += this.F[x++];

//	for (var acc = 0; (acc += this.F[x]) <= freq; x++)
//	    ;
//	acc -= this.F[x];

	// Update range coder
	rc.RangeDecode(src, acc, this.F[x], this.total_freq);

	// Update model
	this.F[x]       += STEP;
	this.total_freq += STEP;
	if (this.total_freq > MAX_FREQ)
	    this.ModelRenormalise();
	

	// Keep symbols approximately frequency sorted
	var sym = this.S[x];
	if (x > 0 && this.F[x] > this.F[x-1]) {
	    var tmp = this.F[x];
	    this.F[x] = this.F[x-1];
	    this.F[x-1] = tmp;

	    tmp = this.S[x];
	    this.S[x] = this.S[x-1];
	    this.S[x-1] = tmp;
	}

	return sym;
    }

    ModelRenormalise() {
	// Halve all the frequencies, being careful not to hit zero
	this.total_freq = 0;
	for (var i = 0; i <= this.max_sym; i++) {
	    this.F[i] -= Math.floor(this.F[i] / 2);
	    this.total_freq += this.F[i];
	}
    }

    ModelEncode(dst, rc, sym) {
	// Find cumulative frequency
	var acc = 0;
	for (var x = 0; this.S[x] != sym; x++)
	    acc += this.F[x];

	// Encode
	rc.RangeEncode(dst, acc, this.F[x], this.total_freq);

	// Update model
	this.F[x]       += STEP;
	this.total_freq += STEP;
	if (this.total_freq > MAX_FREQ) // FIXME x2
	    this.ModelRenormalise();

	// Keep symbols approximately frequency sorted
	var sym = this.S[x];
	if (x > 0 && this.F[x] > this.F[x-1]) {
	    var tmp = this.F[x];
	    this.F[x] = this.F[x-1];
	    this.F[x-1] = tmp;

	    tmp = this.S[x];
	    this.S[x] = this.S[x-1];
	    this.S[x-1] = tmp;
	}
    }
};
