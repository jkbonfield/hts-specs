// Command line tool to manually test the rans.js code.
//
// ./node --use-strict main_rans.js in.o1 out
//
// Runs approx 2.3x slower than C for Order0 and 5x slower for Order1

var fs = require("fs");

if (process.argv.length < 4) {
    process.stderr.write("Usage: node main_rans.js [option] input-file output-file\n");
    process.exit(1);
}

var filein  = process.argv[2];
var fileout = process.argv[3];

var buf = fs.readFileSync(filein);
process.stderr.write("Input file is " + buf.length + " bytes long\n");

var arith = require("./arith_sh");
//var arith = require("./arith");
var buf2 = arith.decode(buf);

process.stderr.write("Output file is " + buf2.length + " bytes long\n");

fs.writeFileSync(fileout, buf2);




