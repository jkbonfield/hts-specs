// Command line tool to manually test the rans.js code.
//
// Runs approx 2.3x slower than C for Order0 and 5x slower for Order1

var fs = require("fs");
var fqz = require("./fqzcomp");
var argv = require('minimist')(process.argv.slice(2), { boolean: "d" });

if (argv._.length != 2) {
    process.stderr.write("Usage: node main_rans.js [-d] input-file output-file\n");
    process.exit(1);
}

var filein  = argv._[0]
var fileout = argv._[1]

var buf = fs.readFileSync(filein);

if (!argv.d) {
    // Line breaks to get sequence length, but then stitch together into
    // a single non-breaking buffer.
    var len = 0;
    var j = 0;
    var q_lens = new Array
    var q_len = 0
    for (var i = 0; i < buf.length; i++) {
	if (buf[i] == "\n".charCodeAt(0)) {
	    q_lens.push(len)
	    if (q_len == 0)
		q_len = len
	    else if (q_len != len)
		q_len = -1 // marker for multiple lengths
	    len = 0;
	} else {
	    buf[j++] = buf[i] - 33; // ASCII phred to raw
	    len++;
	}
    }
    buf = buf.slice(0, j)
    if (q_len > 0)
	q_lens = [q_lens[0]]

    var buf2 = fqz.encode(buf, q_lens);
    process.stderr.write("Compress " +buf.length + " => " + buf2.length + "\n");
    fs.writeFileSync(fileout, buf2);

} else {
    var q_lens = new Array
    var buf2 = fqz.decode(buf, q_lens);

    console.log("decoded")

    // Split into newlines so we can do easy data comparison
    var buf3 = new Buffer(buf2.length + q_lens.length)
    var rec = 0;
    var len = q_lens[rec++]
    var j = 0;
    for (var i = 0; i < buf2.length; i++) {
	buf3[j++] = buf2[i] + 33;
	if (--len == 0) {
	    buf3[j++] = "\n".charCodeAt(0)
	    len = q_lens[rec++]
	}
    }

    process.stderr.write("Decompress " + buf.length + " => " + buf3.length + "\n");
    fs.writeFileSync(fileout, buf3);
}
