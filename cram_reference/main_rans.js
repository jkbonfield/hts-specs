// Command line tool to manually test the rans.js code.
//
// ./node --use-strict main_rans.js in.o1 out
//
// Runs approx 2.3x slower than C for Order0 and 5x slower for Order1

var fs = require("fs");
var rans = require("./rans");
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
    var buf2 = rans.encode(buf, order);
    process.stderr.write("Compress order "+order+", "+buf.length+" => " + buf2.length + "\n");
    fs.writeFileSync(fileout, buf2);

} else {
    var buf2 = rans.decode(buf);
    process.stderr.write("Decompress " + buf.length + " => " + buf2.length + "\n");
    fs.writeFileSync(fileout, buf2);
}
