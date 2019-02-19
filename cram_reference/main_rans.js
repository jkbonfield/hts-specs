var fs = require("fs");

if (process.argv.length < 4) {
    process.stderr.write("Usage: node main_rans.js [option] input-file output-file\n");
    process.exit(1);
}

var filein  = process.argv[2];
var fileout = process.argv[3];

var buf = fs.readFileSync(filein);
process.stderr.write("Input file is " + buf.length + " bytes long\n");

var rans = require("./rans");
var buf2 = rans.decode(buf);

process.stderr.write("Output file is " + buf2.length + " bytes long\n");

fs.writeFileSync(fileout, buf2);




