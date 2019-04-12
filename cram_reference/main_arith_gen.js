// Command line tool to manually test the arith_sh.js code.
//
// Runs approx 2.3x slower than C for Order0 and 5x slower for Order1

var fs = require("fs");
var RangeCoderGen = require("./arith_gen");

var argv = require('minimist')(process.argv.slice(2), { boolean: "d" });

if (argv._.length != 2) {
    process.stderr.write("Usage: node main_rans.js [-d] [-o order] input-file output-file\n");
    process.exit(1);
}

var filein  = argv._[0]
var fileout = argv._[1]

var buf = fs.readFileSync(filein);

var arith = new RangeCoderGen()
if (!argv.d) {
    var order = argv.o != undefined ? argv.o : 0;
    var buf2 = arith.encode(buf, order);
    process.stderr.write("Compress order "+order+", "+buf.length+" => " + buf2.length + "\n");

    // Compressed buffer size. Used in multi-block format (not supported here).
    var csize = new Buffer.allocUnsafe(4);
    csize.writeInt32LE(buf2.length, 0);

    // Write compressed buffer itself
    fs.writeFileSync(fileout, Buffer.concat([csize,buf2]));

} else {
    var buf2 = arith.decode(buf.slice(4));
    process.stderr.write("Decompress " + buf.length + " => " + buf2.length + "\n");
    fs.writeFileSync(fileout, buf2);
}
