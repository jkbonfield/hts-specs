// Command line tool to manually test the arith_sh.js code.
//
// Runs approx 2.3x slower than C for Order0 and 5x slower for Order1

var fs = require("fs");
var RangeCoderGen = require("./arith_gen");

var argv = require('minimist')(process.argv.slice(2), { boolean: "d" });

if (argv._.length != 1) {
    process.stderr.write("Usage: node main_arith_gen.js [-d] [-o order] input-file > output-file\n");
    process.exit(1);
}

var filein  = argv._[0]

var buf = fs.readFileSync(filein);
var blk_size = 1024*1024;

var arith = new RangeCoderGen()
if (!argv.d) {
    var order = argv.o != undefined ? argv.o : 0;
    var pos = 0;
    var out_len = 0;
    while (pos < buf.length) {
	var buf2 = arith.encode(buf.slice(pos, pos+blk_size), order);

	// Compressed buffer size. Used in multi-block format.
	var csize = new Buffer.allocUnsafe(4);
	csize.writeInt32LE(buf2.length, 0);
	process.stdout.write(csize)

	// Write compressed buffer itself
	process.stdout.write(buf2)

	pos += blk_size;
	out_len += buf2.length;
    }
    process.stderr.write("Compress order "+order+", "+buf.length+" => " + out_len + "\n");

} else {
    var pos = 0;
    var out_len = 0;
    while (pos < buf.length) {
	var len = buf.readInt32LE(pos);
	pos += 4;
	var buf2 = arith.decode(buf.slice(pos, pos+len));
	process.stdout.write(buf2);
	out_len += buf2.length;
	pos += len;
    }
    process.stderr.write("Decompress " + buf.length + " => " + out_len + "\n");
}
