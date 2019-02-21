var Int64 = require('node-cint64').Int64;

// Turn a buffer into a fake stream with get / put commands.
// This enables up to closely match the published pseudocode.
module.exports = class IOStream {
    constructor(buf, start_pos = 0) {
	this.buf = buf;
	this.pos = start_pos;
	this.length = buf.length
    }

    ReadByte() {
	const b = this.buf[this.pos]
	this.pos++;
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
};
