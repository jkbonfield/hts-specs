var Int64 = require('node-cint64').Int64;

// Turn a buffer into a fake stream with get / put commands.
// This enables up to closely match the published pseudocode.
module.exports = class IOStream {
    constructor(buf, start_pos = 0, size = 0) {
	if (size != 0) {
	    this.buf = Buffer.allocUnsafe(size)
	    this.length = size
	} else {
	    this.buf = buf
	    this.length = buf.length
	}
	this.pos = start_pos
    }

    // ----------
    // Reading

    ReadByte() {
	const b = this.buf[this.pos]
	this.pos++
	return b
    }

    ReadUint32() {
	const i = this.buf.readInt32LE(this.pos)
	this.pos += 4
	return i
    }

    ReadUint64() {
	const i = new Int64(this.buf.slice(this.pos, this.pos+7));
	this.pos += 8
	return i
    }

    ReadITF8() {
	var i = this.buf[this.pos];
	this.pos++;

	//process.stderr.write("i="+i+"\n");

	if (i >= 0xf0) {
	    // 1111xxxx => +4 bytes
	    i = (i & 0x0f) << 28;
	    i += (this.buf[this.pos+0] << 20)
	      +  (this.buf[this.pos+1] << 12)
	      +  (this.buf[this.pos+2] <<  4)
	      +  (this.buf[this.pos+3] >>  4);
	    this.pos += 4;
	    //process.stderr.write("  4i="+i+"\n");
	} else if (i >= 0xe0) {
	    // 1110xxxx => +3 bytes
	    i = (i & 0x0f) << 24;
	    i += (this.buf[this.pos+0] << 16)
	      +  (this.buf[this.pos+1] <<  8)
	      +  (this.buf[this.pos+2] <<  0);
	    this.pos += 3;
	    //process.stderr.write("  3i="+i+"\n");
	} else if (i >= 0xc0) {
	    // 110xxxxx => +2 bytes
	    i = (i & 0x1f) << 16;
	    i += (this.buf[this.pos+0] << 8)
	      +  (this.buf[this.pos+1] << 0);
	    this.pos += 2;
	    //process.stderr.write("  2i="+i+"\n");
	} else if (i >= 0x80) {
	    // 10xxxxxx => +1 bytes
	    i = (i & 0x3f) << 8;
	    i += this.buf[this.pos];
	    this.pos++;;
	    //process.stderr.write("  1i="+i+"\n");
	} else {
	    // 0xxxxxxx => +0 bytes
	}

	return i;
    }

    // ----------
    // Writing
    WriteByte(b) {
	this.buf[this.pos++] = b
    }

    WriteUint32(u) {
	this.buf.writeInt32LE(u, this.pos);
	this.pos += 4;
    }

    WriteITF8(i) {
	// Horrid, ITF8 is unsigned, but we still write signed into it
	if (i < 0)
	    i = (1<<32) + i

	if (i <= 0x0000007f) {
	    // 1 byte
	    this.buf[this.pos++] = i
	} else if (i <= 0x00003fff) {
	    // 2 bytes
	    this.buf[this.pos++] = 0x80 | Math.floor(i / 256)
	    this.buf[this.pos++] = i & 0xff;
	} else if (i < 0x0001ffff) {
	    // 3 bytes
	    this.buf[this.pos++] = 0xc0 | Math.floor(i / 65536)
	    this.buf[this.pos++] = Math.floor(i / 256) & 0xff
	    this.buf[this.pos++] = i & 0xff;
	} else if (i < 0x0fffffff) {
	    // 4 bytes
	    this.buf[this.pos++] = 0xe0 | Math.floor(i / 16777216)
	    this.buf[this.pos++] = Math.floor(i / 65536) & 0xff
	    this.buf[this.pos++] = Math.floor(i /   256) & 0xff
	    this.buf[this.pos++] = i & 0xff;
	} else {
	    // 5 bytes; oddly using 4.5 bytes
	    this.buf[this.pos++] = 0xf0 | Math.floor(i / 268435456)
	    this.buf[this.pos++] = Math.floor(i / 1048576) & 0xff
	    this.buf[this.pos++] = Math.floor(i /    4096) & 0xff
	    this.buf[this.pos++] = Math.floor(i /       4) & 0xff
	    this.buf[this.pos++] = i & 0x0f;
	}
    }

    // ----------
    // Writing from end of buffer going backwards.
    // Needed by rANS codec.
    WriteByteNeg(b) {
	this.buf[--this.pos] = b;
    }
};
