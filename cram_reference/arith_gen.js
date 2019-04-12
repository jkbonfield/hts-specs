// Validated: decode 0 1 64 65 128 192 193 8 9 4 68
//            encode 0 1 64 65

const RangeCoder = require("./arith_sh");
const IOStream = require("./iostream");
const ByteModel = require("./byte_model");

const ARITH_ORDER  = 1
const ARITH_DICT   = 4
const ARITH_X4     = 8
const ARITH_NOSIZE = 16
const ARITH_CAT    = 32
const ARITH_RLE    = 64
const ARITH_PACK   = 128

module.exports = class RangeCoderGen {
    decode(src) {
	this.stream = new IOStream(src);
	return this.decodeStream(this.stream)
    }

    decodeStream(stream, n_out=0) {
	var flags = this.stream.ReadByte();
	if (!(flags & ARITH_NOSIZE))
	    n_out = this.stream.ReadUint7();
	var e_len = n_out;

	var order = flags & ARITH_ORDER;

	// 4-way recursion
	if (flags & ARITH_X4)
	    return this.decodeX4(this.stream, n_out)

	// NOP, useful for tiny blocks
	if (flags & ARITH_CAT)
	    return this.decodeCat(this.stream, n_out)

	// Meta data
	if (flags & ARITH_DICT) {
	    var D, stride
	    [D, stride] = this.decodeDictMeta(this.stream)
	    e_len /= 4
	}
	if (flags & ARITH_PACK) {
	    var P
	    [P, e_len] = this.decodePackMeta(this.stream)
	}

	// Entropy decode
	if (flags & ARITH_RLE) {
	    var data = order
		? this.decodeRLE1(this.stream, e_len)
		: this.decodeRLE0(this.stream, e_len);
	} else {
	    var data = order
		? this.decode1(this.stream, e_len)
		: this.decode0(this.stream, e_len);
	}

	// Transforms
	if (flags & ARITH_PACK)
	    data = this.decodePack(data, P, n_out)
	if (flags & ARITH_DICT)
	    data = this.decodeDict(data, D, stride, n_out)

	return data
    }

    encode(src, flags) {
	this.stream = new IOStream("", 0, src.length*1.1 + 100); // guestimate worst case!

	this.stream.WriteByte(flags);
	this.stream.WriteUint7(src.length);

	var order = flags & ARITH_ORDER;

	if (flags & ARITH_RLE) {
	    return order
		? this.encodeRLE1(src, this.stream)
		: this.encodeRLE0(src, this.stream);
	} else {
	    return order
		? this.encode1(src, this.stream)
		: this.encode0(src, this.stream);
	}
    }

    //----------------------------------------------------------------------
    // Order-0 codec
    decode0(stream, n_out) {
	var output = new Buffer.allocUnsafe(n_out);

	var max_sym = stream.ReadByte()
	if (max_sym == 0)
	    max_sym = 256

	var byte_model = new ByteModel(max_sym);

	var rc = new RangeCoder(stream);
	rc.RangeStartDecode(stream);

	for (var i = 0; i < n_out; i++)
	    output[i] = byte_model.ModelDecode(stream, rc);

	return output;
    }

    encode0(src,out) {
	const n_in = src.length

	// Count the maximum symbol present
	var max_sym = 0;
	for (var i = 0; i < n_in; i++)
	    if (max_sym < src[i])
		max_sym = src[i]
	max_sym++;  // FIXME not what spec states!?

	var byte_model = new ByteModel(max_sym);
	out.WriteByte(max_sym);
	var rc = new RangeCoder(out);

	for (var i = 0; i < n_in; i++)
	    byte_model.ModelEncode(out, rc, src[i])
	rc.RangeFinishEncode(out)

	return out.buf.slice(0, out.pos);
    }

    //----------------------------------------------------------------------
    // Order-1 codec

    decode1(stream, n_out) {
	var output = new Buffer.allocUnsafe(n_out);

	var max_sym = stream.ReadByte()
	if (max_sym == 0)
	    max_sym = 256

	var byte_model = new Array(max_sym);
	for (var i = 0; i < max_sym; i++)
	    byte_model[i] = new ByteModel(max_sym);

	var rc = new RangeCoder(stream);
	rc.RangeStartDecode(stream);

	var last = 0;
	for (var i = 0; i < n_out; i++) {
	    output[i] = byte_model[last].ModelDecode(stream, rc);
	    last = output[i];
	}

	return output;
    }

    encode1(src, out) {
	const n_in = src.length

	// Count the maximum symbol present
	var max_sym = 0;
	for (var i = 0; i < n_in; i++)
	    if (max_sym < src[i])
		max_sym = src[i]
	max_sym++;  // FIXME not what spec states!

	var byte_model = new Array(max_sym);
	for (var i = 0; i < max_sym; i++)
	    byte_model[i] = new ByteModel(max_sym);
	out.WriteByte(max_sym);
	var rc = new RangeCoder(out);

	var last = 0;
	for (var i = 0; i < n_in; i++) {
	    byte_model[last].ModelEncode(out, rc, src[i])
	    last = src[i]
	}
	rc.RangeFinishEncode(out)

	return out.buf.slice(0, out.pos);
    }

    //----------------------------------------------------------------------
    // Order-0 RLE codec
    decodeRLE0(stream, n_out) {
	var output = new Buffer.allocUnsafe(n_out);

	var max_sym = stream.ReadByte()
	if (max_sym == 0)
	    max_sym = 256

	var model_lit = new ByteModel(max_sym);
	var model_run = new Array(258);
	for (var i = 0; i <= 257; i++)
	    model_run[i] = new ByteModel(4)

	var rc = new RangeCoder(stream);
	rc.RangeStartDecode(stream);

	var i = 0;
	while (i < n_out) {
	    output[i] = model_lit.ModelDecode(stream, rc)
	    var part = model_run[output[i]].ModelDecode(stream, rc)
	    var run = part
	    var rctx = 256
	    while (part == 3) {
		part = model_run[rctx].ModelDecode(stream, rc)
		rctx = 257
		run += part
	    }
	    for (var j = 1; j <= run; j++)
		output[i+j] = output[i]
	    i += run+1
	}

	return output;
    }

    encodeRLE0(src,out) {
	const n_in = src.length

	// Count the maximum symbol present
	var max_sym = 0;
	for (var i = 0; i < n_in; i++)
	    if (max_sym < src[i])
		max_sym = src[i]
	max_sym++;  // FIXME not what spec states!

	var model_lit = new ByteModel(max_sym);
	var model_run = new Array(258);
	for (var i = 0; i <= 257; i++)
	    model_run[i] = new ByteModel(4)

	out.WriteByte(max_sym);
	var rc = new RangeCoder(out);

	var i = 0
	while (i < n_in) {
	    model_lit.ModelEncode(out, rc, src[i])
	    var run = 1
	    while (i+run < n_in && src[i+run] == src[i])
		run++
	    run--

	    var rctx = src[i]
	    var last = src[i]
	    i += run+1

	    var part = run >= 3 ? 3 : run
	    model_run[rctx].ModelEncode(out, rc, part)
	    run -= part
	    rctx = 256
	    while (part == 3) {
		part = run >= 3 ? 3 : run
		model_run[rctx].ModelEncode(out, rc, part)
		rctx = 257
		run -= part
	    }
	}
	rc.RangeFinishEncode(out)

	return out.buf.slice(0, out.pos);
    }

    //----------------------------------------------------------------------
    // Order-1 RLE codec

    decodeRLE1(stream, n_out) {
	var output = new Buffer.allocUnsafe(n_out);

	var max_sym = stream.ReadByte()
	if (max_sym == 0)
	    max_sym = 256

	var model_lit = new Array(max_sym);
	for (var i = 0; i < max_sym; i++)
	    model_lit[i] = new ByteModel(max_sym);

	var model_run = new Array(258);
	for (var i = 0; i <= 257; i++)
	    model_run[i] = new ByteModel(4)

	var rc = new RangeCoder(stream);
	rc.RangeStartDecode(stream);

	var last = 0;
	var i = 0;
	while (i < n_out) {
	    output[i] = model_lit[last].ModelDecode(stream, rc)
	    last = output[i]
	    var part = model_run[output[i]].ModelDecode(stream, rc)
	    var run = part
	    var rctx = 256
	    while (part == 3) {
		part = model_run[rctx].ModelDecode(stream, rc)
		rctx = 257
		run += part
	    }
	    for (var j = 1; j <= run; j++)
		output[i+j] = output[i]
	    i += run+1
	}

	return output;
    }

    encodeRLE1(src,out) {
	const n_in = src.length

	// Count the maximum symbol present
	var max_sym = 0;
	for (var i = 0; i < n_in; i++)
	    if (max_sym < src[i])
		max_sym = src[i]
	max_sym++;  // FIXME not what spec states!

	var model_lit = new Array(max_sym)
	for (var i = 0; i < max_sym; i++)
	    model_lit[i] = new ByteModel(max_sym);
	var model_run = new Array(258);
	for (var i = 0; i <= 257; i++)
	    model_run[i] = new ByteModel(4)

	out.WriteByte(max_sym);
	var rc = new RangeCoder(out);

	var i = 0
	var last = 0
	while (i < n_in) {
	    model_lit[last].ModelEncode(out, rc, src[i])
	    var run = 1
	    while (i+run < n_in && src[i+run] == src[i])
		run++
	    run--

	    var rctx = src[i]
	    last = src[i]
	    i += run+1

	    var part = run >= 3 ? 3 : run
	    model_run[rctx].ModelEncode(out, rc, part)
	    run -= part
	    rctx = 256
	    while (part == 3) {
		part = run >= 3 ? 3 : run
		model_run[rctx].ModelEncode(out, rc, part)
		rctx = 257
		run -= part
	    }
	}
	rc.RangeFinishEncode(out)

	return out.buf.slice(0, out.pos);
    }

    //----------------------------------------------------------------------
    // Pack method
    decodePackMeta(stream) {
	this.nsym  = stream.ReadByte()

	var M = new Array(this.nsym);
	for (var i = 0; i < this.nsym; i++)
	    M[i] = stream.ReadByte()

	var e_len = stream.ReadUint7(); // Could be derived data from nsym and n_out

	return [M, e_len]
    }

    decodePack(data, M, len) {
	var out = new Buffer.allocUnsafe(len);

	if (this.nsym <= 1) {
	    // Constant value
	    for (var i = 0; i < len; i++)
		out[i] = M[0]

	} else if (this.nsym <= 2) {
	    // 1 bit per value
	    for (var i = 0, j = 0; i < len; i++) {
		if (i % 8 == 0)
		    var v = data[j++]
		out[i] = M[v & 1]
		v >>= 1
	    }

	} else if (this.nsym <= 4) {
	    // 2 bits per value
	    for (var i = 0, j = 0; i < len; i++) {
		if (i % 4 == 0)
		    var v = data[j++]
		out[i] = M[v & 3]
		v >>= 2
	    }

	} else if (this.nsym <= 16) {
	    // 4 bits per value
	    for (var i = 0, j = 0; i < len; i++) {
		if (i % 2 == 0)
		    var v = data[j++]
		out[i] = M[v & 15]
		v >>= 4
	    }

	} else {
	    // 8 bits per value: NOP
	    return data
	}

	return out
    }

    //----------------------------------------------------------------------
    // Dict method
    decodeDictMeta(stream) {
	var stride = stream.ReadByte()
	var n = stream.ReadByte()

	var D = new Array(n);
	var i = 0;
	while (i < n) {
	    var x = stream.ReadByte()
	    var lit = x % 16;
	    var run = x / 16;

	    for (var j = 0; j < lit; j++)
		D[i+j] = stream.ReadUint7()
	    i += lit
	    if (run > 0) {
		for (var j = 0; j < run; j++)
		    D[i+j] = D[i+j-1]+1
		i += run;
	    }
	}

	return [D, stride]
    }

    decodeDict(data, D, stride, len) {
	var out = new Buffer.allocUnsafe(len);

	for (var i = 0, j = 0; i < len; i+=stride, j++) {
	    var v = D[data[j]]
	    out[i+0] = (v >>  0) & 255
	    if (stride > 1)
		out[i+1] = (v >>  8) & 255
	    if (stride > 2)
		out[i+2] = (v >> 16) & 255
	    if (stride > 3)
		out[i+3] = (v >> 24) & 255
	}

	return out
    }

    //----------------------------------------------------------------------
    // X4 method
    decodeX4(stream, len) {
	var plen = len/4
	
	var clen = new Array(4);
	for (var i = 0; i < 4; i++)
	    clen[i] = stream.ReadUint7()

	var X0 = this.decodeStream(stream, plen)
	var X1 = this.decodeStream(stream, plen)
	var X2 = this.decodeStream(stream, plen)
	var X3 = this.decodeStream(stream, plen)
	
	var out = new Buffer.allocUnsafe(len);
	for (var i = 0, j = 0; j < plen; j++) {
	    out[i+0] = X0[j]
	    out[i+1] = X1[j]
	    out[i+2] = X2[j]
	    out[i+3] = X3[j]
	    i += 4;
	}

	return out
    }

    //----------------------------------------------------------------------
    // Cat method
    decodeCat(stream, len) {
	var out = new Buffer.allocUnsafe(len);
	for (var i = 0; i < len; i++)
	    out[i] = stream.ReadByte()

	return out
    }
}
