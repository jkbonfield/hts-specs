// Name tokeniser
//
// This is a reference implementation designed to match the
// written specification as closely as possible.  It is *NOT*
// an efficient implementation, but see comments below.

const IOStream = require("./iostream");

//----------------------------------------------------------------------
// Token byte streams
function DecodeTokenByteStreams(src) {
    return
}

//----------------------------------------------------------------------
// Main rANS entry function: decodes a compressed src and
// returns the uncompressed buffer.
function decode(src) {
    var stream = new IOStream(src)
    var ulen = src.ReadInt()
    var nnames = src.ReadInt()

    console.log(ulen,nnames)

    var B = DecodeTokenByteStreams(src)
}

module.exports = { decode }
