// Command line tool to manually test the arith_sh.js code.
//
// Runs approx 2.3x slower than C for Order0 and 5x slower for Order1

var fs = require("fs");
const IOStream = require("./iostream");
var RangeCoder = require("./arith_sh");
const ByteModel = require("./byte_model");

var argv = require('minimist')(process.argv.slice(2), { boolean: "d" });

if (argv._.length != 2) {
    process.stderr.write("Usage: node main_rans.js [-d] [-o order] input-file output-file\n");
    process.exit(1);
}

var filein  = argv._[0]
var fileout = argv._[1]

var buf = fs.readFileSync(filein);

if (!argv.d) {
    var order = argv.o != undefined ? argv.o : 0;
    var buf2 = encode(buf, order);
    process.stderr.write("Compress order "+order+", "+buf.length+" => " + buf2.length + "\n");
    fs.writeFileSync(fileout, buf2);

} else {
    var order = argv.o != undefined ? argv.o : 0;
    var buf2 = decode(buf, order);
    process.stderr.write("Decompress " + buf.length + " => " + buf2.length + "\n");
    fs.writeFileSync(fileout, buf2);
}

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
